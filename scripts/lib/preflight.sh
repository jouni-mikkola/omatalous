# shellcheck shell=bash
# What update.sh does around the switch. Before the old container stops it tries the new image's database migrations on
# the verified copy of the database (`migrate-check`, 0.6.0 and later), and it puts everything back when that fails.
# After a healthy start it records whether the schema changed, for the rollback dialog. A rollback whose database has
# another migration history than the pre-update copy asks the previous image whether it opens the database as it is
# (previous_reads_database), so a rollback keeps the data written since the update when it can.
# Sourced by update.sh, which provides IMAGE, CHANNEL, STATE, prev_commit, COPY_SNAPSHOT, in_app, app_up, run_logged,
# project_name, say, ok and die.

# How long the new version may take to answer, in seconds: 120 unless the migration check on the copy took long.
HEALTH_WAIT=120
# Waits until the app answers, for at most HEALTH_WAIT seconds by the clock. A turn counts the time it took and at least
# its 2 s sleep. The maintenance helper ends an update at TALOUS_DEADLINE (epoch seconds), so the wait stops 60 s before
# that, but never shorter than 60 s: a start that would have succeeded must not be rolled back because the wait ran
# into the helper's timeout.
healthy() {
  local cid waited=0 turn left limit=$HEALTH_WAIT
  if [[ ${TALOUS_DEADLINE:-} =~ ^[0-9]{9,11}$ ]]; then
    left=$((TALOUS_DEADLINE - $(date +%s) - 60))
    ((left >= limit)) || limit=$((left > 60 ? left : 60))
  fi
  while ((waited < limit)); do
    turn=$SECONDS
    app_up && return 0
    # a container that keeps restarting will not come up by waiting
    cid=$(docker compose ps -a -q banking 2>/dev/null | head -1 || true)
    [[ -z $cid ]] || [[ $(docker inspect -f '{{.RestartCount}}' "$cid" 2>/dev/null || echo 0) -lt 3 ]] || return 1
    sleep 2
    turn=$((SECONDS - turn))
    waited=$((waited + (turn > 2 ? turn : 2)))
  done
  return 1
}

# True when an image (default: the new one, $IMAGE:latest) has `migrate-check`. The command is asked without a file: an
# image that has it prints its usage and exits 2, an older one does something else (0.5.x treats it as an unknown
# command). No volume is mounted for the question, so an older image cannot touch the data.
migrate_check_available() { # migrate_check_available [IMAGE]
  local rc=0
  docker run --rm --network none --entrypoint node "${1:-$IMAGE:latest}" --disable-warning=ExperimentalWarning dist/node.js migrate-check >/dev/null 2>&1 || rc=$?
  ((rc == 2))
}
# What a rollback is about to overwrite, or to keep and start an older version on, is copied first (the 5 newest
# pre-rollback-*.db stay), so nothing is lost for good. The app is stopped. Needs DBCOPY_JS (lib/dbcopy.sh). When the copy
# fails nothing has changed: the app is started again and the rollback ends.
save_before_rollback() {
  if ! docker compose run --rm --no-deps -T --entrypoint node banking --disable-warning=ExperimentalWarning -e "$DBCOPY_JS" 'exists,keep:^pre-rollback-[0-9TZ]+\.db$' "/data/backups/pre-rollback-$(date -u +%Y%m%dT%H%M%SZ).db"; then
    docker compose start banking >/dev/null
    die "Could not copy the current database (is the disk full?). Nothing was changed and the current version was started again."
  fi
  ok "The current database was saved first (pre-rollback-*.db)."
}
# How long the previous image may take to look at the live database, in seconds. A check that runs longer is a refusal.
# It stays well inside the maintenance helper's 10 minutes for a rollback, so the restore still fits after it.
PREVIOUS_CHECK_WAIT=120
# The volume behind /data, found by the labels Compose put on it (the project name depends on the folder or .env).
data_volume() {
  docker volume ls -q --filter "label=com.docker.compose.project=$(project_name)" --filter 'label=com.docker.compose.volume=banking-data' 2>/dev/null | head -1
}
# The rollback's question, asked with the app stopped: does the previous image ($IMAGE:previous, the one the rollback
# starts) open the live database as it is? Its own `migrate-check` answers it. Exit 0 with a JSON line that lists no
# applied migration means it opens the file and has nothing to change, so the data written since the update can stay.
# Every other answer is a no and returns 1: the check refused the file (exit 1), it would apply migrations (the old
# image would change the live database at start), the image has no such command, docker failed or the time ran out. The image is first
# asked without a file (migrate_check_available), so one that lacks the command never gets the data volume. The
# container has no network and the limits of the app service in docker-compose.yml, and runs as the image's user, which
# is the service's.
previous_reads_database() {
  local log volume rc=0 guard=() name="$IMAGE-rollback-check"
  if ! migrate_check_available "$IMAGE:previous"; then
    say "The previous version has no migration check, so it is not asked about the database."
    return 1
  fi
  volume=$(data_volume) || true
  if [[ -z $volume ]]; then
    say "The data volume was not found, so the previous version is not asked about the database."
    return 1
  fi
  # A plain docker run has no time limit. timeout (and a kill) ends the docker client only, so the container has a name,
  # per instance, and is removed by name after any failure: it must not run on into the restore and the app start.
  ! command -v timeout >/dev/null || guard=(timeout -k 10 "$PREVIOUS_CHECK_WAIT")
  # a leftover of a run that was killed hard would block the name
  [[ -z $(docker ps -aq --filter "name=^$name\$" 2>/dev/null) ]] || docker rm -f "$name" >/dev/null 2>&1 || true
  log=$(mktemp)
  run_logged "$log" "Checking" ${guard[@]+"${guard[@]}"} docker run --rm --name "$name" --network none --read-only --tmpfs /tmp:noexec,nosuid,nodev,size=16m \
    --cap-drop ALL --security-opt no-new-privileges:true --memory 512m --pids-limit 200 -v "$volume:/data" \
    --entrypoint node "$IMAGE:previous" --disable-warning=ExperimentalWarning dist/node.js migrate-check /data/banking.db || rc=$?
  if ((rc != 0)); then
    docker rm -f "$name" >/dev/null 2>&1 || true
    if ((rc == 1)); then
      # the check's own line says why it refused
      { grep -E '^migrate-check' "$log" || tail -n 3 "$log"; } | cut -c1-400 | sed 's/^/  /' >&2
    elif ((rc == 124 || rc == 137)); then
      printf 'The previous version took longer than %s s to look at the database, or was killed.\n' "$PREVIOUS_CHECK_WAIT" >&2
    else
      printf 'The previous version could not be asked about the database (exit code %s). End of its output:\n' "$rc" >&2
      tail -n 3 "$log" | cut -c1-400 | sed 's/^/  /' >&2
    fi
  fi
  # the JSON line is the check's own, e.g. {"ok":true,"file":...,"applied":[],"ahead":[...],...}
  if ((rc == 0)) && ! grep -E '^\{"ok":true,' "$log" | grep -q '"applied":\[\],'; then
    printf 'The previous version has changes of its own to make to the database, so it is not kept as it is. End of its output:\n' >&2
    tail -n 3 "$log" | cut -c1-400 | sed 's/^/  /' >&2
    rc=1
  fi
  rm -f "$log"
  ((rc == 0))
}
# Tries the new image's migrations on the verified copy while the old container still runs. Returns 1 when the check
# itself failed (migrate-check exits 1: the migrations, the integrity check or the row counts) and 2 when it could not
# run (docker, out of memory, an unreadable file), which says nothing about the migrations. The time it took sets
# HEALTH_WAIT: three times as long, at least 120 s and at most 900 s (the maintenance helper ends an update after 20
# minutes).
preflight_migrations() { # preflight_migrations SNAPSHOT
  local log rc=0 ms budget
  if ! migrate_check_available; then
    say "The new version has no migration check, so its migrations are not tried on a copy first."
    return 0
  fi
  log=$(mktemp)
  # a one-off container of the new image: the running one is still the old version
  run_logged "$log" "Checking" docker compose run --rm --no-deps -T --entrypoint node banking --disable-warning=ExperimentalWarning dist/node.js migrate-check "$1" || rc=$?
  if ((rc != 0)); then
    if ((rc == 1)); then
      # the app's own line says what failed
      { grep -E '^migrate-check' "$log" || tail -n 5 "$log"; } | cut -c1-400 | sed 's/^/  /' >&2
    else
      printf 'The migration check could not run (exit code %s). End of its output:\n' "$rc" >&2
      tail -n 5 "$log" | cut -c1-400 | sed 's/^/  /' >&2
    fi
    rm -f "$log"
    ((rc == 1)) && return 1
    return 2
  fi
  ms=$(sed -nE 's/^\{"ok":true,"file":"[^"]*","elapsed_ms":([0-9]+),.*/\1/p' "$log" | tail -1)
  ok "$(grep -E '^migrate-check' "$log" | tail -1 | cut -c1-300)"
  rm -f "$log"
  if [[ $ms =~ ^[0-9]+$ ]]; then
    budget=$((ms * 3 / 1000))
    ((budget >= 120)) || budget=120
    ((budget <= 900)) || budget=900
    # shellcheck disable=SC2034 # read by healthy in update.sh
    HEALTH_WAIT=$budget
  fi
  return 0
}
# The image the app container was made from, as an image ID. It stays right when :latest has moved to a new image.
running_image() {
  local cid
  cid=$(docker compose ps -a -q banking 2>/dev/null | head -1 || true)
  [[ -n $cid ]] || return 1
  docker inspect -f '{{.Image}}' "$cid" 2>/dev/null
}
# Before the switch the only changes are that the new image is tagged :latest and, in source mode, that the checkout
# moved. Undo both, so a later `docker compose up` or update run starts from the version that is running. update.sh
# calls it from its exit trap, so a failure, an interrupt or the helper's timeout before the switch ends here too.
keep_old_running() {
  if docker image inspect "$IMAGE:pending-previous" >/dev/null 2>&1; then
    docker image tag "$IMAGE:pending-previous" "$IMAGE:latest" >/dev/null 2>&1 && docker image rm "$IMAGE:pending-previous" >/dev/null 2>&1 || true
  fi
  if [[ $CHANNEL == source && -n ${prev_commit:-} ]]; then git reset --keep "$prev_commit" >/dev/null 2>&1 || true; fi
}
# After a healthy start: did the update change the schema? The migration names of the live database are compared with the
# pre-update copy, the way --rollback does. The answer joins the state file as SCHEMA_CHANGED=yes or no, and the
# maintenance helper passes it on as `schema_changed`: a rollback after a schema change restores the copy and loses what
# was written since, and the dialog says so. Nothing here fails the update.
record_schema_change() {
  local changed
  [[ -n ${COPY_SNAPSHOT:-} && -f $STATE ]] || return 0
  changed=$(in_app -e '
    const { DatabaseSync } = require("node:sqlite");
    const names = (f) => new DatabaseSync(f, { readOnly: true }).prepare("SELECT group_concat(name) AS n FROM (SELECT name FROM _migrations ORDER BY name)").get().n;
    console.log(names("/data/banking.db") === names(process.argv[1]) ? "no" : "yes");' "$COPY_SNAPSHOT" 2>/dev/null | tail -1) || return 0
  [[ $changed == yes || $changed == no ]] || return 0
  { grep -v '^SCHEMA_CHANGED=' "$STATE"; printf 'SCHEMA_CHANGED=%s\n' "$changed"; } | (umask 077; atomic_write "$STATE") || true
}
