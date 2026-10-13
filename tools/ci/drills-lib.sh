# shellcheck shell=bash disable=SC2034
# What the drills of tools/ci/drills.sh stand on, sourced by it after its variables are set (DIR, LOGS, URL, NAME, JAR, PASS,
# NODE, CLOCK, REMOTE, DEV, DEADLINE; NAME is the container's): the bookkeeping of a drill (step, die, skip, fresh), the app's API on the
# rehearsal's install, and the maintenance helper with a clock that can be set ahead and the releases the drills push.
# It defines functions and runs nothing. The drills themselves are in drills.sh. What upgrade-run.sh needs as well (dc, shim,
# app_version, migrations, golden_rows, api, until_ok, push_release) is in lib.sh.

# shellcheck source=lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh" || exit 1

# ── bookkeeping ─────────────────────────────────────────────────────────────
# step is the drills' log: its line also goes to $LOGS/step; upgrade-run.sh has its own `log`
step() { printf '%s\n' "$*" >"$LOGS/step"; printf '\n-- %s\n' "$*"; }
# die REASON [SEEN...]: REASON goes on the drill's result line. What the drill saw is printed under that line by run_drill:
# SEEN, then SAW when a helper such as login set it, then what the drill's own SAW_FN prints.
die() {
  printf '%s\n' "$1" >"$LOGS/reason"; printf 'FAILED: %s\n' "$1"; shift
  { (($# == 0)) || printf '%s\n' "$@"; [[ -z ${SAW:-} ]] || printf '%s\n' "$SAW"; [[ -z ${SAW_FN:-} ]] || "$SAW_FN"; } >"$LOGS/saw" 2>&1
  exit 1
}
# saw_with FUNCTION: from here on a failure of this drill also prints what FUNCTION prints
saw_with() { SAW_FN=$1; }
# skip REASON: the drill could not be tried for a cause outside the product. Its result reads "skipped" and is no failure.
skip() { printf '%s\n' "$1" >"$LOGS/reason"; printf 'SKIPPED: %s\n' "$1"; exit 77; }
# newest FILE...: the newest of the files that exist
newest() { local f r=""; for f in "$@"; do [[ -e $f ]] && [[ -z $r || $f -nt $r ]] && r=$f; done; printf '%s' "$r"; }
note_result() { local r=${3//$'\n'/ }; printf '%s|%s|%s\n' "$1" "$2" "$r" >>"$LOGS/results"; printf 'drill %s %s: %s\n' "$1" "$2" "$r"; }

# ── the app ─────────────────────────────────────────────────────────────────
started_at() { docker inspect -f '{{.State.StartedAt}}' "$NAME"; }
restarted() { [[ $(started_at) != "$1" ]]; }
# login: signs in as the admin. On a refusal SAW holds the answer, for die
login() {
  local code
  rm -f "$JAR" "$LOGS/body"
  code=$(curl -sS --max-time 60 -o "$LOGS/body" -w '%{http_code}' -c "$JAR" -H 'Content-Type: application/json' -H 'X-Requested-With: fetch' \
    -d "{\"username\":\"ci-admin\",\"password\":\"$PASS\"}" "$URL/api/auth/login" 2>"$LOGS/curl.err") || code="no answer ($(head -c 200 "$LOGS/curl.err"))"
  [[ $code == 2?? ]] && return 0
  SAW="POST /api/auth/login: $code $(body); the container is $(docker inspect -f '{{.State.Status}}, started {{.State.StartedAt}}' "$NAME" 2>&1)"
  return 1
}
# fresh: a drill's own clean start. An earlier drill that failed may have left the app stopped (SIGSTOP) or down.
# No signal goes through `docker kill` here: Docker takes any of them as a stop by hand and then does not start the
# container again when the app next exits by itself, which is the restart the restore drill waits for. A restart wakes a
# stopped process too, and gives the container its restart policy back.
fresh() {
  SAW=""
  rm -f "$CLOCK/stopped"
  until_ok 6 app_ok && return 0
  dc restart -t 2 banking >/dev/null 2>&1 || dc up -d banking >/dev/null 2>&1
  until_ok 150 app_ok || die "the app does not answer at the start of the drill" "docker ps: $(docker ps -a --format '{{.Names}} {{.Image}} {{.Status}}' 2>&1 | head -n 4 | tr '\n' ';')"
}
# the audit list on stdin as lines "action: outcome [user]", the eight newest
audit_rows() { tr '{' '\n' | sed -n 's/.*"username":\([^,]*\),.*"action":"\([^"]*\)","outcome":"\([^"]*\)".*/\2: \3 [\1]/p' | head -n 8; }
# post PATH JSON: the status code on stdout, the body in $LOGS/body
post() { curl -sS --max-time 90 -o "$LOGS/body" -w '%{http_code}' -b "$JAR" -c "$JAR" -H 'Content-Type: application/json' -H 'X-Requested-With: fetch' -d "$2" "$URL$1"; }
body() { head -c 300 "$LOGS/body" 2>/dev/null; }
notices() { api "$URL/api/security/notices"; }
# the rows that must survive, of a database file inside the container (golden_rows in lib.sh reads them)
golden_of() { golden_rows "$1"; }
# a change after the copy, so that the live data and the copy differ
mutate() {
  dc exec -T banking "${NODE[@]}" -e 'const d = new (require("node:sqlite").DatabaseSync)("/data/banking.db"); d.exec("DELETE FROM transactions WHERE id IN (SELECT id FROM transactions ORDER BY id DESC LIMIT 3)"); d.exec("PRAGMA wal_checkpoint(TRUNCATE)"); d.close();'
}
# a checked copy of the live data as the newest manual copy (the way the helper's backup makes one); sets COPY
make_copy() {
  COPY=manual-$(date -u +%Y%m%dT%H%M%SZ).db
  # shellcheck source=../../scripts/lib/dbcopy.sh
  ( . "$DIR/scripts/lib/dbcopy.sh" && dc exec -T banking "${NODE[@]}" -e "$DBCOPY_JS" 'keep:^manual-[0-9TZ]+\.db$' "/data/backups/$COPY" )
}
data_volume() { docker inspect -f '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Name}}{{end}}{{end}}' "$NAME"; }
# restore_api: Palauta viimeisin through the API, then waits for the app to restart by itself; sets RESTORED
restore_api() {
  local before
  before=$(started_at)
  code=$(post /api/ops/restore-latest "{\"password\":\"$PASS\",\"confirm\":\"PALAUTA\"}")
  [[ $code == 202 ]] || die "POST restore-latest answered $code: $(body)"
  RESTORED=$(sed -n 's/.*"name":"\([^"]*\)".*/\1/p' "$LOGS/body")
  until_ok 60 restarted "$before" || die "the app did not restart by itself within 60 s (restart policy: $(docker inspect -f '{{.HostConfig.RestartPolicy.Name}}' "$NAME"))"
  until_ok 150 app_ok || die "the app did not answer after its restart"
}

# ── the helper on this install: a clock that can be set ahead, a policy, one tick ──
# The helper looks at the app with `timeout 20 docker compose exec -T banking wget ...` (app_up in scripts/ops-helper.sh),
# and a look at an app that SIGSTOP has stopped can only end by that timeout: drill 3 makes several of them with the app
# stopped, 20 s each. timeout_shim DIR REAL writes a `timeout` for the front of
# the helper's PATH that, while the file DIR/stopped is there, gives that one call LOOK_WAIT seconds instead; every other
# call goes on to the real timeout (REAL) as it came. A look at a stopped app fails after 5 s as it does after 20, and the
# watchdog reads only that it failed. If the helper ever asks in other words, the call is not matched and only the time
# comes back.
LOOK_WAIT=5
timeout_shim() {
  cat >"$1/timeout" <<EOF
#!/bin/bash
if [[ -e "$1/stopped" && \$1 == 20 && "\${*:2:6}" == "docker compose exec -T banking wget" ]]; then set -- $LOOK_WAIT "\${@:2}"; fi
exec "$2" "\$@"
EOF
  chmod 755 "$1/timeout"
}
# stop_app: SIGSTOP for the app, and the mark that makes the helper's looks short (timeout_shim); fresh takes the mark away
stop_app() { docker kill -s STOP "$NAME" >/dev/null && : >"$CLOCK/stopped"; }
prep_ops() {
  [[ -f $LOGS/ops-ready ]] && return 0
  git -C "$DIR" remote set-url origin "file://$REMOTE" || return 1
  mkdir -p "$DIR/ops/journal" "$DIR/ops/run" && chmod 700 "$DIR/ops" "$DIR/ops/journal" "$DIR/ops/run" || return 1
  printf 'REMOTE_URL=file://%s\nBRANCH=ci\n' "$REMOTE" >"$DIR/ops/policy" && chmod 600 "$DIR/ops/policy" || return 1
  : >"$DIR/ops/last-check" # the first tick need not run the daily check and doctor
  printf '0\n' >"$CLOCK/offset"
  cat >"$CLOCK/date" <<EOF
#!/bin/bash
# the real date, ahead by the number in $CLOCK/offset seconds; a call with its own -d is the real one
off=\$(cat "$CLOCK/offset" 2>/dev/null || echo 0)
for a in "\$@"; do [[ \$a == -d || \$a == --date* ]] && exec /bin/date "\$@"; done
exec /bin/date -d "@\$(( \$(/bin/date +%s) + off ))" "\$@"
EOF
  chmod 755 "$CLOCK/date" || return 1
  timeout_shim "$CLOCK" "$(command -v timeout)" && touch "$LOGS/ops-ready"
}
# tick OFFSET: one tick of this checkout's helper, with the clock OFFSET seconds ahead
tick() {
  local t=$((DEADLINE - SECONDS))
  printf '%s\n' "$1" >"$CLOCK/offset"
  ((t > 10)) || return 124
  ((t > 420)) && t=420
  # OPS_T_WAKE=0: no wait for a press in an idle tick. A drill proves the actions; the wait has its own suite, tools/test/ops-wake.test.sh
  (cd "$DIR" && exec env OPS_TEST=1 OPS_T_WAKE=0 PATH="$CLOCK:$PATH" timeout -k 10 "$t" ./scripts/ops-helper.sh) >>"$LOGS/tick.out" 2>&1
}
# tick_at V: one tick with the helper's clock V seconds after CLOCK0 (the drill sets it to $SECONDS) when the tick starts.
# The real seconds since CLOCK0 are taken off the offset: a look at an app that does not answer takes the helper up to 20 s
# (LOOK_WAIT with the mark of stop_app), and with a plain offset two looks "179 s apart" were 199 s apart, over
# WATCHDOG_GAP, so the watchdog counted nothing.
tick_at() {
  local off=$(($1 - (SECONDS - CLOCK0)))
  ((off >= 0)) || off=0
  tick "$off"
}
clock_start() { CLOCK0=$SECONDS; }
since() { cat "$DIR/ops/watchdog-since" 2>/dev/null || echo none; }
helper_log_has() { grep -E -- "$1" "$DIR/ops/helper.log" >/dev/null 2>&1; }
# what the watchdog had to go on, for a failed drill 3
watchdog_saw() {
  local f
  echo "ops/watchdog-since (START SECONDS LAST JOURNAL): $(since); the helper's clock $(PATH="$CLOCK:$PATH" date +%s), the real one $(/bin/date +%s)"
  echo "backups/.last-update: $(tr '\n' ' ' <"$DIR/backups/.last-update" 2>/dev/null | cut -c1-200)"
  for f in "$DIR"/ops/watchdog-*Z "$DIR/ops/RECOVERY.txt"; do [[ -e $f ]] && echo "ops/${f##*/}: $(head -c 200 "$f" | tr '\n' ' ')"; done
  if (flock -n 9) 9<"$DIR"; then f=free; else f=held; fi
  echo "the installer's lock (the clone folder) is $f; update.sh or install.sh running: $(pgrep -u "$EUID" -af '(update|install)\.sh' | cut -c1-100 | tr '\n' ';')"
  echo "container: $(docker inspect -f '{{.State.Status}} {{.Config.Image}} started {{.State.StartedAt}}' "$NAME" 2>&1), version $(app_version)"
  f=$(newest "$DIR"/ops/run/watchdog-*.log); [[ -z $f ]] || { echo "the end of ops/run/${f##*/}:"; tail -n 4 "$f"; }
  echo "the end of the ticks' output:"; tail -n 4 "$LOGS/tick.out" 2>/dev/null
}
# what the helper left of its last request, for a failed drill 4
ops_saw() {
  local f
  f=$(newest "$DIR"/ops/journal/*.result)
  echo "the newest result (${f##*/}): $(head -c 400 "$f" 2>/dev/null | tr '\n' ' ')"
  echo "ops/watchdog.frag: $(cat "$DIR/ops/watchdog.frag" 2>/dev/null || echo none); HEAD $(git -C "$DIR" rev-parse --short HEAD), running $(app_version)"
  f=$(newest "$DIR"/ops/run/*.log); [[ -z $f ]] || { echo "the end of ops/run/${f##*/}:"; tail -n 6 "$f"; }
  echo "the end of the ticks' output:"; tail -n 5 "$LOGS/tick.out" 2>/dev/null
}
merged() { [[ $(git -C "$DIR" rev-parse HEAD) == "$1" ]]; }
# the releases the drills push (push_release in lib.sh), each run in the clone as the function named
release_watchdog() { # a migration the previous version cannot read, and a changed install.sh
  rm -f apps/server/migrations/9998_ci_bad.sql
  sed -i 's/^export const APP_VERSION = .*/export const APP_VERSION = "9999.1.0";/' apps/server/src/version.ts
  echo "ALTER TABLE accounts ADD COLUMN drill_note TEXT;" >apps/server/migrations/9999_drill_watchdog.sql
  echo "# drill: this release changes install.sh" >>scripts/install.sh
}
release_selftest() { # a helper whose self-test fails
  printf '%s\n' 'self_test() { echo "self-test failed: the app does not respond"; return 1; }' >>scripts/lib/ops-selftest.sh
}

