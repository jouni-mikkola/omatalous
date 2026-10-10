#!/usr/bin/env bash
# Tests for scripts/ops-helper.sh (and the update path it drives) against a stub docker, a stub cosign and
# curl, and a local bare git remote. Nothing here touches the network, a real container or a real registry.
#
#   scripts/test/ops-helper.test.sh [name-filter]
#
# The helper refuses to run as root, so a root run (a container, say) copies the scripts and runs the
# tests as an unprivileged user; the refusal itself is checked first.
set -u
umask 022
HERE=$(cd "$(dirname "$0")" && pwd)
SRC=${OPS_TEST_SRC:-$(cd "$HERE/../.." && pwd)}
FILTER=${1:-}

# ── root: check the refusal, then run everything as nobody on a copy ────────
if [[ $EUID -eq 0 && -z ${OPS_TEST_CHILD:-} ]]; then
  base=$(mktemp -d); chmod 755 "$base"
  mkdir -p "$base/src"; cp -r "$SRC/scripts" "$SRC/docker-compose.yml" "$base/src/"
  chown -R 65534:65534 "$base"
  out=$(cd "$base/src" && TALOUS_OPS_CLEAN="" ./scripts/ops-helper.sh 2>&1); rc=$?
  if [[ $rc -ne 0 && $out == *"does not run as root"* ]]; then echo "ok   helper refuses to run as root"; rootfail=0
  else echo "FAIL helper refuses to run as root (rc $rc: $out)"; rootfail=1; fi
  setpriv --reuid=65534 --regid=65534 --clear-groups env -u TMPDIR HOME="$base" OPS_TEST_CHILD=1 OPS_TEST_SRC="$base/src" bash "$base/src/scripts/test/ops-helper.test.sh" "$FILTER"
  rc=$?
  rm -rf "$base"
  exit $((rc || rootfail))
fi

PASS=0; FAILED=0
pass() { PASS=$((PASS + 1)); echo "ok   $1"; }
fail() { FAILED=$((FAILED + 1)); echo "FAIL $1"; [[ -z ${2:-} ]] || echo "       $2"; }
check() { # check NAME CMD...
  local n=$1; shift
  if "$@"; then pass "$n"; else fail "$n"; fi
}
want() { [[ -z $FILTER || $1 == *$FILTER* ]]; }

TMPBASE=$(mktemp -d)
trap 'rm -rf "$TMPBASE"' EXIT
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@example.com GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@example.com
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null
REG=ghcr.io/jouni-mikkola/omatalous

# ── the stubs ───────────────────────────────────────────────────────────────
write_stubs() {
  local b=$S/bin
  cat >"$b/docker" <<'EOF'
#!/usr/bin/env bash
S=$OPS_STUB_DIR
printf 'docker %s\n' "$(printf '%s ' "$@" | tr '\n' ' ' | cut -c1-200)" >>"$S/calls.log"
key() { printf '%s' "$1" | tr '/:@' '___'; }
ver_of() { [[ -f $S/images/$(key "$1") ]] && cut -d'|' -f1 "$S/images/$(key "$1")"; }
healthy() { [[ -e $S/running ]] && [[ ! -e $S/bad_$(cat "$S/cver" 2>/dev/null) ]]; }
last_arg() { eval "printf '%s' \"\${$#}\""; }
case ${1:-} in
  info) [[ $* == *DockerRootDir* ]] && echo "$S/root"; exit 0 ;;
  version) echo 27.0.0; exit 0 ;;
  volume) echo vol; exit 0 ;;
  inspect)
    case $* in *RestartCount*) echo 0 ;; *.Image*) echo "id-$(cat "$S/cver" 2>/dev/null)" ;; esac; exit 0 ;;
  pull)
    [[ -e $S/pullfail ]] && exit 1
    v=${2##*:}; [[ -f $S/registry/$v ]] || exit 1
    cp "$S/registry/$v" "$S/images/$(key "$2")"; cp "$S/registry/$v" "$S/images/$(key "$REG_IMG@sha256:$(printf %s "$v" | sha256sum | cut -c1-64)")"
    echo pulled; exit 0 ;;
  image)
    case ${2:-} in
      tag) [[ -f $S/images/$(key "$3") ]] || exit 1; cp "$S/images/$(key "$3")" "$S/images/$(key "$4")"; exit 0 ;;
      inspect)
        ref=${@: -1}; f=$S/images/$(key "$ref"); [[ -f $f ]] || exit 1
        IFS='|' read -r v c cp <"$f"
        case $* in
          *RepoDigests*) echo "$REG_IMG@sha256:$(printf %s "$v" | sha256sum | cut -c1-64)" ;;
          *talous.commit*) echo "$c" ;;
          *talous.version*) echo "$v" ;;
          *talous.compose*) echo "$cp" ;;
          *.Id*) echo "id-$v" ;;
        esac; exit 0 ;;
      *) exit 0 ;;
    esac ;;
  compose)
    shift
    case ${1:-} in
      version) if [[ -f $S/race.sh ]]; then bash "$S/race.sh"; rm -f "$S/race.sh"; fi; echo 2.29.0; exit 0 ;;
      -f) exec /usr/bin/docker compose "$@" ;;
      config) printf '{\n  "name": "clone"\n}\n'; exit 0 ;;
      ps)
        case $* in
          *"--status running"*) [[ -e $S/running ]] && echo cid1 ;;
          *) [[ -e $S/container ]] && echo cid1 ;;
        esac; exit 0 ;;
      exec)
        [[ -e $S/running ]] || exit 1
        case $* in
          *wget*) healthy; exit $? ;;
          *"ops poll"*) if [[ -f $S/poll ]]; then cat "$S/poll"; [[ -e $S/poll-keep ]] || rm -f "$S/poll"; else echo '{"request":null}'; fi; exit 0 ;;
          *"ops report"*) n=$(ls "$S/reports" | wc -l); cat >"$S/reports/$((n + 1)).json"; echo '{"ok":true}'; exit 0 ;;
          *"ops state"*) cat >"$S/state.last"; echo '{"ok":true}'; exit 0 ;;
          *"dist/node.js version"*) echo "$(cat "$S/cver") (test)"; exit 0 ;;
          *" -e "*) [[ -e $S/fail-snapshot ]] && exit 1; echo "SNAPSHOT $(last_arg "$@")" >>"$S/calls.log"; echo same; exit 0 ;;
        esac; exit 0 ;;
      run)
        case $* in
          *"--entrypoint node"*) [[ -e $S/fail-snapshot ]] && exit 1; echo "SNAPSHOT $(last_arg "$@")" >>"$S/calls.log"; echo same; exit 0 ;;
        esac; exit 0 ;;
      build)
        [[ -e $S/failbuild ]] && { echo "build failed: boom" >&2; exit 1; }
        echo "${APP_VERSION:-?}|${GIT_COMMIT:-?}|1" >"$S/images/$(key banking-app:latest)"; exit 0 ;;
      up)
        [[ -e $S/failup ]] && exit 1
        touch "$S/running" "$S/container"; v=$(ver_of banking-app:latest); echo "$v" >"$S/cver"; exit 0 ;;
      stop) rm -f "$S/running"; exit 0 ;;
      start) touch "$S/running"; exit 0 ;;
      restart) [[ -e $S/hang-restart ]] && exec /bin/sleep 1000; exit 0 ;;
      logs|down|pull) exit 0 ;;
    esac; exit 0 ;;
esac
exit 0
EOF
  sed -i "s#^S=\$OPS_STUB_DIR#S=\$OPS_STUB_DIR; REG_IMG=$REG#" "$b/docker"
  cat >"$b/cosign" <<'EOF'
#!/usr/bin/env bash
printf 'cosign %s\n' "$*" >>"$OPS_STUB_DIR/calls.log"
[[ -e $OPS_STUB_DIR/cosignfail ]] && exit 1
[[ $* == *"--certificate-oidc-issuer https://token.actions.githubusercontent.com"* && $* == *"release\\.yml@refs/tags/"* && $* == *"@sha256:"* ]] || exit 1
[[ $* == *"--certificate-github-workflow-sha "????????????????????????????????????????" "* && $* == *"--certificate-github-workflow-trigger push"* ]] || exit 1
exit 0
EOF
  cat >"$b/curl" <<'EOF'
#!/usr/bin/env bash
S=$OPS_STUB_DIR; out=""; url=""
while (($#)); do case $1 in -o) out=$2; shift ;; http*) url=$1 ;; esac; shift; done
printf 'curl %s\n' "$url" >>"$S/calls.log"
[[ $url == https://api.github.com/repos/jouni-mikkola/omatalous/releases/latest ]] || { printf 000; exit 1; }
code=$(cat "$S/release.status" 2>/dev/null || echo 200)
[[ $code != 200 ]] || cp "$S/release.json" "$out"
printf '%s' "$code"
EOF
  cat >"$b/df" <<'EOF'
#!/usr/bin/env bash
if [[ -e $OPS_STUB_DIR/lowdisk ]]; then printf 'Filesystem 1024-blocks Used Available Capacity Mounted on\nx 100000 90000 10240 90%% /\n'; else exec /bin/df "$@"; fi
EOF
  printf '#!/bin/sh\nexec /bin/sleep 0.01\n' >"$b/sleep"
  chmod +x "$b"/*
}

# a world: stub state, a bare remote with one commit (0.1.0), a clone with the helper, a running 0.1.0
new_world() {
  W=$(mktemp -d "$TMPBASE/w.XXXXXX"); S=$W/stub
  mkdir -p "$S"/{bin,images,registry,reports,root} "$W/home"
  write_stubs
  git init -q --bare -b main "$W/origin.git"
  git clone -q "file://$W/origin.git" "$W/seed" 2>/dev/null
  mkdir -p "$W/seed/apps/server/src" "$W/seed/scripts/lib"
  cp "$SRC"/scripts/*.sh "$W/seed/scripts/"; cp "$SRC"/scripts/lib/*.sh "$W/seed/scripts/lib/"; cp "$SRC/docker-compose.yml" "$W/seed/"
  printf '#!/usr/bin/env bash\necho "backup.sh ran" >>"$OPS_STUB_DIR/calls.log"\nprintf "\\033[31mred\\033[0m\\nToken abcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuv end\\nAuthorization: Bearer xyz\\nTUNNEL_TOKEN=abc\\nkept line\\n"\n' >"$W/seed/scripts/backup.sh"
  printf '#!/usr/bin/env bash\necho '"'"'{"at":"2026-01-01T00:00:00Z","items":[{"id":"x-1","level":"ok","title":"t","detail":"","hint":""}]}'"'"'\n' >"$W/seed/scripts/doctor.sh"
  chmod +x "$W"/seed/scripts/*.sh
  printf '/ops/\n/backups/\n.env\n' >"$W/seed/.gitignore"
  echo 'export const APP_VERSION = "0.1.0";' >"$W/seed/apps/server/src/version.ts"
  git -C "$W/seed" add -A && git -C "$W/seed" commit -qm "0.1.0" && git -C "$W/seed" push -q origin main 2>/dev/null
  C1=$(git -C "$W/seed" rev-parse HEAD)
  git clone -q "file://$W/origin.git" "$W/clone" 2>/dev/null
  CL=$W/clone
  mkdir -p "$CL/ops"; chmod 700 "$CL/ops"
  printf 'REMOTE_URL=file://%s/origin.git\nBRANCH=main\n' "$W" >"$CL/ops/policy"; chmod 600 "$CL/ops/policy"
  : >"$CL/.env"; chmod 600 "$CL/.env"
  # the running version
  echo "0.1.0|$C1|1" >"$S/images/$(printf %s banking-app:latest | tr '/:@' '___')"
  touch "$S/running" "$S/container"; echo 0.1.0 >"$S/cver"; : >"$S/calls.log"
  echo 200 >"$S/release.status"
}
setenv() { printf '%s\n' "$@" >"$CL/.env"; chmod 600 "$CL/.env"; }
poll() { printf '{"request":{"id":"%s","action":"%s","params":{},"secret":null}}\n' "${2:-op_0123456789abcdef}" "$1" >"$S/poll"; }
tick() { # one tick of the helper in the clone, as the timer would run it
  (cd "$CL" && env OPS_TEST=1 OPS_STUB_DIR="$S" HOME="$W/home" PATH="$S/bin:/usr/local/bin:/usr/bin:/bin" "$@" ./scripts/ops-helper.sh >"$W/tick.out" 2>&1)
  TICK_RC=$?
}
calls() { cat "$S/calls.log" 2>/dev/null; }
n_calls() { calls | grep -cE "$1" || true; }
# the newest report's text
report() { local f; f=$(ls "$S/reports" | sort -n | tail -1); [[ -n $f ]] && cat "$S/reports/$f" || true; }
reported() { grep -q "\"status\":\"$1\"" <<<"$(report)"; }
nreports() { ls "$S/reports" | wc -l; }
head_commit() { git -C "$CL" rev-parse HEAD; }
cver() { cat "$S/cver"; }
# a release in the seed: version.ts, a commit, a tag, the registry image and what the Releases API says
release() { # release VERSION
  echo "export const APP_VERSION = \"$1\";" >"$W/seed/apps/server/src/version.ts"
  git -C "$W/seed" add -A; git -C "$W/seed" commit -qm "release $1"; git -C "$W/seed" tag "v$1"
  git -C "$W/seed" push -q origin main "v$1" 2>/dev/null
  echo "$1|$(git -C "$W/seed" rev-parse HEAD)|1" >"$S/registry/$1"
  printf '{\n  "tag_name": "v%s",\n  "body": "Notes for %s\\n- one"\n}\n' "$1" "$1" >"$S/release.json"
}
src_commit() { # a source commit on main
  echo "x$RANDOM" >>"$W/seed/CHANGES"
  git -C "$W/seed" add -A; git -C "$W/seed" commit -qm "change $RANDOM"; git -C "$W/seed" push -q origin main 2>/dev/null
}
ID=op_0123456789abcdef
ID2=op_fedcba9876543210

# ── release mode ────────────────────────────────────────────────────────────
t_release_update() {
  new_world; release 0.2.0; poll update
  tick
  check "release: update reported ok" reported ok
  check "release: running version is now 0.2.0" test "$(cver)" = 0.2.0
  check "release: pulled the release image" test "$(n_calls "^docker pull $REG:0.2.0")" = 1
  check "release: cosign verified the digest against the pinned issuer and workflow" test "$(n_calls '^cosign verify .*@sha256:')" = 1
  check "release: the copy was taken before the switch (snapshot before up)" bash -c "calls=\$(grep -nE '^SNAPSHOT /data/backups/pre-update-|^docker compose up' '$S/calls.log' | head -2); [[ \$calls == *SNAPSHOT*up* || \$calls == *SNAPSHOT*docker* ]]"
  check "release: checkout moved to the tag" test "$(head_commit)" = "$(git -C "$W/seed" rev-parse v0.2.0)"
  check "release: no local build" test "$(n_calls '^docker compose build')" = 0
  check "release: journal written and marked reported" grep -q '"reported":true' "$CL/ops/journal/$ID.json"
  check "release: state file for rollback exists (600)" test "$(stat -c %a "$CL/backups/.last-update")" = 600
}
t_release_not_newer() {
  new_world; release 0.2.0; echo 0.2.0 >"$S/cver"; echo "0.2.0|$(git -C "$W/seed" rev-parse HEAD)|1" >"$S/images/$(printf %s banking-app:latest | tr '/:@' '___')"
  poll update; tick
  check "release: same version is not installed" test "$(n_calls "^docker pull")" = 0
  check "release: same version reported as already current" grep -q "jo käytössä" <<<"$(report)"
  rm -f "$S/reports"/*; : >"$S/calls.log"
  echo 0.3.0 >"$S/cver"; poll update "$ID2"; tick
  check "release: a lower release than the running version is not installed" test "$(n_calls "^docker pull")" = 0
}
t_release_cosign_fails() {
  new_world; release 0.2.0; touch "$S/cosignfail"; poll update; local before; before=$(head_commit)
  tick
  check "release: failed signature reported failed" reported failed
  check "release: unsigned image never tagged or started" test "$(n_calls '^docker (image tag ghcr|compose up)')" = 0
  check "release: old version still running" test "$(cver)" = 0.1.0
  check "release: checkout unchanged" test "$(head_commit)" = "$before"
}
t_release_bad_image() {
  new_world; release 0.2.0
  echo "0.2.0|0000000000000000000000000000000000000000|1" >"$S/registry/0.2.0"
  poll update; tick
  check "release: image built from another commit is refused" reported failed
  check "release: refused image not started" test "$(cver)" = 0.1.0
}
t_release_health_fails_rolls_back() {
  new_world; release 0.2.0; touch "$S/bad_0.2.0"; poll update; local before; before=$(head_commit)
  tick
  check "release: unhealthy new version reported failed" reported failed
  check "release: rolled back by itself to 0.1.0" test "$(cver)" = 0.1.0
  check "release: checkout back at the previous commit" test "$(head_commit)" = "$before"
  check "release: no RECOVERY.txt when the rollback worked" test ! -e "$CL/ops/RECOVERY.txt"
}
t_release_rollback_fails_too() {
  new_world; release 0.2.0; touch "$S/bad_0.2.0" "$S/bad_0.1.0"; poll update
  tick
  check "release: both failing reports failed" reported failed
  check "release: RECOVERY.txt written" test -s "$CL/ops/RECOVERY.txt"
  check "release: RECOVERY.txt has the exact commands" grep -q './scripts/update.sh --rollback' "$CL/ops/RECOVERY.txt"
}
t_release_rollback_action() {
  new_world; release 0.2.0; poll update; tick
  poll rollback "$ID2"; tick
  check "rollback: previous version is back" test "$(cver)" = 0.1.0
  check "rollback: reported ok" reported ok
  poll rollback op_aaaaaaaaaaaaaaaa; tick
  check "rollback: only one rollback per update" reported failed
}
t_release_pull_fails() {
  new_world; release 0.2.0; touch "$S/pullfail"; poll update; tick
  check "release: failed pull reported failed, old version running" bash -c "grep -q '\"status\":\"failed\"' '$S/reports/1.json' && [[ $(cat "$S/cver") = 0.1.0 ]]"
}
t_release_api_offline() {
  new_world; echo 503 >"$S/release.status"; poll check-update; tick
  check "release: API error reported as failed check, nothing else" reported failed
  check "release: API error changes nothing" test "$(n_calls '^docker (pull|build|compose up)')" = 0
}
t_release_fixed_url() {
  new_world; release 0.2.0; poll check-update; tick
  check "release: the Releases API of the project is the only URL asked" test "$(calls | grep -c '^curl ' )" = 1
  check "release: check reports the new version" grep -q '"update_available":true' "$S/reports/1.json"
}
t_tag_not_forward() {
  new_world; release 0.2.0; git -C "$W/seed" push -q -f origin "$C1:refs/heads/main" 2>/dev/null
  # the release tag now points at a commit that does not descend from this checkout's HEAD
  git -C "$CL" fetch -q origin 2>/dev/null; git -C "$CL" merge -q --ff-only origin/main 2>/dev/null
  echo "x" >"$W/seed/other"; git -C "$W/seed" add -A; git -C "$W/seed" commit -qm other; git -C "$W/seed" push -q origin main 2>/dev/null
  git -C "$CL" fetch -q origin 2>/dev/null; git -C "$CL" merge -q --ff-only origin/main 2>/dev/null
  poll update; tick
  check "release: a tag that is not a step forward is refused" reported failed
  check "release: refused tag, nothing pulled" test "$(n_calls '^docker pull')" = 0
}

# ── source mode ─────────────────────────────────────────────────────────────
t_source_update() {
  new_world; setenv TALOUS_CHANNEL=source; src_commit; src_commit
  echo 'export const APP_VERSION = "0.1.1";' >"$W/seed/apps/server/src/version.ts"; git -C "$W/seed" add -A; git -C "$W/seed" commit -qm v; git -C "$W/seed" push -q origin main 2>/dev/null
  poll update; tick
  check "source: fast-forward update reported ok" reported ok
  check "source: built and started" bash -c "[[ $(grep -c '^docker compose build' "$S/calls.log") = 1 && $(cver) = 0.1.1 ]]"
  check "source: checkout moved to origin/main" test "$(head_commit)" = "$(git -C "$W/seed" rev-parse HEAD)"
}
t_source_force_push() {
  new_world; setenv TALOUS_CHANNEL=source; src_commit; src_commit; git -C "$CL" fetch -q origin 2>/dev/null; git -C "$CL" merge -q --ff-only origin/main
  local before; before=$(head_commit)
  git -C "$W/seed" reset -q --hard "$C1"; src_commit; git -C "$W/seed" push -q -f origin main 2>/dev/null
  poll update; tick
  check "source: force-pushed branch refused" reported failed
  check "source: force push, no build" test "$(n_calls '^docker compose build')" = 0
  check "source: force push, checkout unchanged" test "$(head_commit)" = "$before"
}
t_source_url_branch_dirty() {
  new_world; setenv TALOUS_CHANNEL=source; src_commit
  git -C "$CL" remote set-url origin "file://$W/elsewhere.git"; poll update; tick
  check "source: changed remote URL refused" bash -c "grep -q 'Etäosoite on muuttunut' '$S/reports/1.json'"
  git -C "$CL" remote set-url origin "file://$W/origin.git"; rm -f "$S/reports"/*
  git -C "$CL" checkout -q -b other; poll update "$ID2"; tick
  check "source: changed branch refused" grep -q 'Haara on muuttunut' <<<"$(report)"
  git -C "$CL" checkout -q main; echo dirty >>"$CL/scripts/doctor.sh"; rm -f "$S/reports"/*
  poll update op_1111111111111111; tick
  check "source: dirty tree refused" grep -q 'paikallisia muutoksia' <<<"$(report)"
  check "source: none of the refusals built anything" test "$(n_calls '^docker compose build')" = 0
}
t_source_remote_types() {
  new_world; setenv TALOUS_CHANNEL=source; src_commit
  local u
  for u in http://example.invalid/x.git git://example.invalid/x.git ext::sh%20-c%20id; do
    git -C "$CL" remote set-url origin "$u"; printf 'REMOTE_URL=%s\nBRANCH=main\n' "$u" >"$CL/ops/policy"
    rm -f "$S/reports"/*; poll update; tick
    check "source: remote $u refused" reported failed
  done
  check "source: no fetch or build from a refused scheme" test "$(n_calls '^docker (compose build|pull)')" = 0
}
# inject ANCHOR_REGEX TEXT: TEXT after the first line of the seed's compose file that matches
inject() {
  awk -v re="$1" -v add="$2" '{print} $0 ~ re && !d {print add; d=1}' "$W/seed/docker-compose.yml" >"$W/seed/dc.new" && mv "$W/seed/dc.new" "$W/seed/docker-compose.yml"
}
# policy_case NAME CMD...: a fresh seed at the first commit, CMD changes it, one source update must be refused
policy_case() {
  local name=$1; shift
  git -C "$W/seed" fetch -q origin 2>/dev/null; git -C "$W/seed" reset -q --hard "$C1"; git -C "$W/seed" clean -qfd; git -C "$W/seed" push -q -f origin main 2>/dev/null
  git -C "$CL" fetch -q origin 2>/dev/null
  "$@"
  git -C "$W/seed" add -A; git -C "$W/seed" commit -qm "evil compose"; git -C "$W/seed" push -q origin main 2>/dev/null
  rm -f "$S/reports"/*; : >"$S/calls.log"; poll update; tick
  check "source: $name refused before build" bash -c "grep -q 'turvasääntöjä' '$S/reports/1.json' && [[ $(grep -c '^docker compose build' "$S/calls.log") = 0 ]]"
}
t_source_compose_policy() {
  new_world; setenv TALOUS_CHANNEL=source
  [[ -x /usr/bin/docker ]] && /usr/bin/docker compose version >/dev/null 2>&1 || { fail "compose policy: needs docker compose on this machine"; return; }
  policy_case "privileged" inject '^  banking:$' "    privileged: true"
  policy_case "quoted privileged and pid" inject '^  banking:$' '    "privileged": true\n    "pid": "host"'
  policy_case "flow merge" inject '^  banking:$' "    <<: {privileged: true, pid: host}"
  policy_case "cap_add" inject '^  banking:$' "    cap_add: [SYS_ADMIN]"
  policy_case "network_mode host" inject '^  banking:$' "    network_mode: host"
  policy_case "long bind of /" inject 'banking-secrets:/secrets' '      - type: bind\n        source: /\n        target: /host'
  policy_case "flow bind of /" inject 'banking-secrets:/secrets' "      - {type: bind, source: /, target: /host}"
  policy_case "short bind of the Docker socket" inject 'banking-secrets:/secrets' "      - /var/run/docker.sock:/var/run/docker.sock"
  policy_case "named volume bound to a host path" sed -i 's#^  banking-data:$#  banking-data:\n    driver_opts: {type: none, o: bind, device: /root}#' "$W/seed/docker-compose.yml"
  policy_case "top-level secret from a host file" bash -c "printf 'secrets:\n  sh:\n    file: /etc/shadow\n' >>'$W/seed/docker-compose.yml' && awk '{print} /banking-secrets:\/secrets/ && !d {print \"    secrets: [sh]\"; d=1}' '$W/seed/docker-compose.yml' >'$W/seed/dc.new' && mv '$W/seed/dc.new' '$W/seed/docker-compose.yml'"
  policy_case "other image" sed -i 's#image: caddy:2#image: evil/caddy:2#' "$W/seed/docker-compose.yml"
  policy_case "other service" inject '^services:$' "  extra:\n    image: caddy:2"
  policy_case "extra capability-free key (devices)" inject '^  banking:$' "    devices: [/dev/sda:/dev/sda]"
  policy_case "a compose.yaml next to it" bash -c "printf 'services: {}\n' >'$W/seed/compose.yaml'"
  policy_case "an override file" bash -c "printf 'services: {}\n' >'$W/seed/docker-compose.override.yml'"
}
t_real_compose_passes() {
  new_world; setenv TALOUS_CHANNEL=source; src_commit
  [[ -x /usr/bin/docker ]] && /usr/bin/docker compose version >/dev/null 2>&1 || { fail "compose policy: needs docker compose on this machine"; return; }
  check "source: the project's own docker-compose.yml passes the policy check" bash -c "cd '$CL' && export PATH='$S/bin:/usr/bin:/bin' && mkdir -p ops/run && source <(sed -n '/^COMPOSE_JQ=/,/^}/p' scripts/ops-helper.sh) && OPS=ops && git fetch -q origin && compose_policy_ok origin/main || { echo \"\$POLICY_MSG\"; exit 1; }"
}
make_signers() {
  ssh-keygen -q -t ed25519 -N '' -f "$W/key1" -C k1; ssh-keygen -q -t ed25519 -N '' -f "$W/key2" -C k2
  printf 'test@example.com namespaces="git" %s\n' "$(cut -d' ' -f1,2 "$W/key1.pub")" >"$CL/ops/allowed_signers"; chmod 600 "$CL/ops/allowed_signers"
}
signed_commit() { # signed_commit KEYFILE
  echo "s$RANDOM" >>"$W/seed/CHANGES"; git -C "$W/seed" add -A
  git -C "$W/seed" -c gpg.format=ssh -c "user.signingkey=$1" commit -q -S -m signed && git -C "$W/seed" push -q origin main 2>/dev/null
}
t_source_signatures() {
  new_world; setenv TALOUS_CHANNEL=source; make_signers
  src_commit; poll update; tick
  check "source: unsigned commit refused when a signers file exists" grep -q 'allekirjoittanut' <<<"$(report)"
  new_world; setenv TALOUS_CHANNEL=source; make_signers
  signed_commit "$W/key2"; poll update; tick
  check "source: commit signed by another key refused" grep -q 'allekirjoittanut' <<<"$(report)"
  new_world; setenv TALOUS_CHANNEL=source; make_signers
  src_commit; signed_commit "$W/key1"; poll update; tick
  check "source: a signed tip over an unsigned commit refused" grep -q 'allekirjoittanut' <<<"$(report)"
  new_world; setenv TALOUS_CHANNEL=source; make_signers
  signed_commit "$W/key1"; poll update; tick
  check "source: commit signed by the trusted key goes through" reported ok
  check "source: only the good one built" test "$(n_calls '^docker compose build')" = 1
}
t_source_check_update() {
  new_world; setenv TALOUS_CHANNEL=source; src_commit; poll check-update; tick
  check "source: check lists the new commit" grep -q '"behind_commits":\[{"hash"' "$S/reports/1.json"
  check "source: check says an update is available" grep -q '"update_available":true' "$S/reports/1.json"
}

# ── the helper picks the commit, update.sh installs only that one ───────────
t_rt_tag_bypasses_signers() {
  # a signed commit on main, and an unsigned commit on a side branch tagged as a newer release
  new_world; make_signers
  signed_commit "$W/key1"
  local good; good=$(git -C "$W/seed" rev-parse HEAD)
  git -C "$W/seed" checkout -q -b side "$C1"
  printf 'echo pwned >>"$OPS_STUB_DIR/calls.log"\n' >>"$W/seed/scripts/ops-helper.sh"
  git -C "$W/seed" add -A; git -C "$W/seed" commit -qm "unsigned"; git -C "$W/seed" tag v0.9.0
  git -C "$W/seed" push -q origin side v0.9.0 2>/dev/null; git -C "$W/seed" checkout -q main
  echo "0.9.0|$(git -C "$W/seed" rev-parse v0.9.0)|1" >"$S/registry/0.9.0"
  echo 404 >"$S/release.status"
  git -C "$CL" fetch -q --tags origin 2>/dev/null
  poll update; tick
  check "tag bypass: the signed main commit is what gets installed" test "$(head_commit)" = "$good"
  check "tag bypass: the unsigned tag is not an ancestor of HEAD" bash -c "! git -C '$CL' merge-base --is-ancestor v0.9.0 HEAD"
  check "tag bypass: no release image pulled" test "$(n_calls '^docker pull')" = 0
  check "tag bypass: helper script unchanged" bash -c "! grep -q pwned '$CL/scripts/ops-helper.sh'"
}
t_rt_source_race() {
  # an unsigned commit lands after the helper's check, while update.sh is running
  new_world; setenv TALOUS_CHANNEL=source; make_signers
  signed_commit "$W/key1"
  local good; good=$(git -C "$W/seed" rev-parse HEAD)
  printf 'cd "%s" && echo evil >>CHANGES && git add -A && git -c user.name=t -c user.email=t@example.com commit -qm evil && git push -q origin main 2>/dev/null\n' "$W/seed" >"$S/race.sh"
  poll update; tick
  check "source race: the late commit did land on the remote" bash -c "git -C '$W/origin.git' log --format=%s main | grep -q evil"
  check "source race: exactly the checked commit is installed" test "$(head_commit)" = "$good"
  check "source race: reported ok" reported ok
}
t_rt_previous_retag() {
  new_world; release 0.2.0; poll update; tick
  release 0.3.0; touch "$S/cosignfail"; rm -f "$S/reports"/*; poll update "$ID2"; tick
  check "previous: the failed update reported failed" reported failed
  check "previous: :previous is still the 0.1.0 image" test "$(cut -d'|' -f1 "$S/images/banking-app_previous")" = 0.1.0
  rm -f "$S/cosignfail" "$S/reports"/*; poll rollback op_aaaaaaaaaaaaaaaa; tick
  check "previous: a rollback after the failed update goes to 0.1.0" bash -c "[[ $(cver) = 0.1.0 ]]"
}
t_release_not_on_main() {
  # a release tag whose commit is on a side branch, not on the pinned branch
  new_world
  git -C "$W/seed" checkout -q -b side
  echo 'export const APP_VERSION = "0.2.0";' >"$W/seed/apps/server/src/version.ts"
  git -C "$W/seed" add -A; git -C "$W/seed" commit -qm side; git -C "$W/seed" tag v0.2.0
  git -C "$W/seed" push -q origin side v0.2.0 2>/dev/null; git -C "$W/seed" checkout -q main
  echo "0.2.0|$(git -C "$W/seed" rev-parse v0.2.0)|1" >"$S/registry/0.2.0"
  printf '{\n  "tag_name": "v0.2.0",\n  "body": "x"\n}\n' >"$S/release.json"
  poll update; tick
  check "release: a tag that is not on the pinned branch is refused" reported failed
  check "release: nothing pulled for it" test "$(n_calls '^docker pull')" = 0
}
t_release_signers() {
  new_world; make_signers; release 0.2.0; poll update; tick
  check "release: unsigned release commit refused when a signers file exists" grep -q 'allekirjoittanut' <<<"$(report)"
  check "release: nothing pulled" test "$(n_calls '^docker pull')" = 0
  new_world; make_signers
  echo 'export const APP_VERSION = "0.2.0";' >"$W/seed/apps/server/src/version.ts"; git -C "$W/seed" add -A
  git -C "$W/seed" -c gpg.format=ssh -c "user.signingkey=$W/key1" commit -q -S -m "release 0.2.0"; git -C "$W/seed" tag v0.2.0
  git -C "$W/seed" push -q origin main v0.2.0 2>/dev/null
  echo "0.2.0|$(git -C "$W/seed" rev-parse HEAD)|1" >"$S/registry/0.2.0"
  printf '{\n  "tag_name": "v0.2.0",\n  "body": "x"\n}\n' >"$S/release.json"
  poll update; tick
  check "release: a signed release commit goes through" reported ok
}
t_utf8_summary() {
  local out
  out=$(printf '\033[31m✗ Levy täynnä äöå %0200d\n' 0 | LANG=C bash -c "source <(sed -n '/^last_problem()/,/^}/p' '$SRC/scripts/ops-helper.sh'); last_problem")
  check "summary: starts at the text and is valid UTF-8 under LANG=C" bash -c "[[ '$out' == Levy* ]] && printf '%s' '$out' | iconv -f UTF-8 -t UTF-8 >/dev/null"
}
t_git_config_pinned() {
  new_world; setenv TALOUS_CHANNEL=source; src_commit
  printf '[gpg "ssh"]\n\tprogram = %s/pwn.sh\n' "$W" >>"$CL/.git/config"
  printf '#!/bin/sh\ntouch %s/pwned\nexit 1\n' "$W" >"$W/pwn.sh"; chmod +x "$W/pwn.sh"
  make_signers; poll update; tick
  check "git config: gpg.ssh.program from .git/config is not run" test ! -e "$W/pwned"
  chmod 664 "$CL/.git/config"; : >"$S/calls.log"; rm -f "$S/reports"/*; poll backup op_9999999999999999; tick
  check "git config: a group-writable .git/config stops the helper" bash -c "[[ $TICK_RC != 0 && \$(grep -c 'backup.sh ran' '$S/calls.log') = 0 ]]"
}

# ── the poll answer is untrusted ────────────────────────────────────────────
t_poll_injection() {
  new_world
  local i=0 fx
  local -a fixtures=(
    '{"request":{"id":"op_0123456789abcdef","action":"update; touch PWN","params":{},"secret":null}}'
    '{"request":{"id":"op_../../x","action":"update","params":{},"secret":null}}'
    '{"request":{"id":"op_0123456789abcdef","action":"update","params":{},"secret":null,"cmd":"touch PWN"}}'
    '{"request":{"id":"op_0123456789abcdef","action":"update","params":{"a":"$(touch PWN)"},"secret":null}}'
    '{"request":{"id":"op_0123456789abcdef","action":"update","params":{},"secret":"abc"}}'
    '{"request":{"id":"op_0123456789abcdef","action":"access","params":{},"secret":null}}'
    '{"request":{"id":"op_0123456789abcdef","action":"port","params":{},"secret":null}}'
    '{"request":{"id":"OP_0123456789ABCDEF","action":"update","params":{},"secret":null}}'
    '{"request":{"id":"op_0123456789abcde","action":"update","params":{},"secret":null}}'
    '{"request":{"id":"op_0123456789abcdef","action":"UPDATE","params":{},"secret":null}}'
    '{"request":{"id":"op_0123456789abcdef","action":"update","params":{},"secret":null}}{"request":null}'
    'hello; touch PWN'
    '{"request":{"id":"op_0123456789abcdef","action":"ba\nckup","params":{},"secret":null}}'
  )
  for fx in "${fixtures[@]}"; do
    i=$((i + 1)); : >"$S/calls.log"; rm -f "$W/pwn" "$CL/pwn" "$CL/PWN"
    printf '%b\n' "${fx//PWN/$W/pwn}" >"$S/poll"
    tick
    check "poll fixture $i: nothing run, nothing written" bash -c "[[ ! -e '$W/pwn' && ! -e '$CL/PWN' && \$(grep -cE '^docker (compose (build|up|restart|stop)|pull)|^cosign|backup.sh ran' '$S/calls.log') = 0 && -z \$(ls '$CL/ops/journal' 2>/dev/null) && \$(ls '$S/reports' | wc -l) = 0 ]]"
  done
  : >"$S/calls.log"; head -c 9000 /dev/zero | tr '\0' 'a' | sed 's/^/{"request":{"id":"op_0123456789abcdef","action":"update","params":{},"secret":null,"x":"/; s/$/"}}/' >"$S/poll"
  tick
  check "poll fixture big: 9 KB answer dropped" bash -c "[[ \$(grep -cE '^docker (compose (build|up)|pull)' '$S/calls.log') = 0 && -z \$(ls '$CL/ops/journal') ]]"
  check "poll: the drop is logged" grep -q 'bad poll' "$CL/ops/helper.log"
  poll backup; tick
  check "poll: control, a well-formed request in the same world still runs" test "$(n_calls 'backup.sh ran')" = 1
}
t_journal_replay() {
  new_world; poll backup; tick
  check "journal: first backup ran" test "$(n_calls 'backup.sh ran')" = 1
  poll backup; tick
  check "journal: the same id from the database again is not run" test "$(n_calls 'backup.sh ran')" = 1
  rm -rf "$S/reports"/*; poll backup "$ID2"; tick
  check "journal: a new id runs" test "$(n_calls 'backup.sh ran')" = 2
}

# ── refusals before anything runs ───────────────────────────────────────────
t_permissions() {
  new_world; poll backup
  chmod 777 "$CL/scripts"; tick
  check "perms: world-writable scripts/ refused" bash -c "[[ $TICK_RC != 0 && \$(grep -c . '$S/calls.log') = 0 ]]"
  chmod 755 "$CL/scripts"; chmod 770 "$CL/ops"; tick
  check "perms: group-writable ops/ refused" test "$TICK_RC" != 0
  chmod 700 "$CL/ops"; chmod 666 "$CL/.env"; tick
  check "perms: writable .env refused" test "$TICK_RC" != 0
  chmod 600 "$CL/.env"; chmod 664 "$CL/scripts/ops-helper.sh"; tick
  check "perms: group-writable helper script refused" test "$TICK_RC" != 0
  chmod 755 "$CL/scripts/ops-helper.sh"; tick
  check "perms: fixed again, it runs" test "$(n_calls 'backup.sh ran')" = 1
}
t_env_poison() {
  new_world; local l
  for l in 'COMPOSE_FILE=/tmp/evil.yml' 'DOCKER_HOST=tcp://evil:2375' 'LD_PRELOAD=/tmp/x.so' 'FOO=$(touch PWN)' 'COMPOSE_PROFILES=evil' 'PATH=/tmp/evil' 'INSTANCE_NAME=a b' 'GIT_SSH_COMMAND=touch PWN' 'BASH_ENV=/tmp/x'; do
    rm -f "$S/reports"/* "$CL/ops/journal"/*; : >"$S/calls.log"; rm -f "$W/pwn" "$CL/PWN"
    setenv "${l//PWN/$W/pwn}"; poll backup; tick
    check ".env '${l:0:28}' refused, nothing run" bash -c "[[ $TICK_RC != 0 && ! -e '$W/pwn' && \$(grep -c . '$S/calls.log') = 0 ]]"
  done
  setenv 'COMPOSE_PROFILES=caddy' 'HOST_PORT=8081' '# a comment' ''; : >"$S/calls.log"; poll backup; tick
  check ".env with plain keys and a comment is accepted" test "$(n_calls 'backup.sh ran')" = 1
}
t_lock_and_disk() {
  new_world; poll backup
  exec 7>"$CL/ops/.lock"; flock -n 7
  tick
  check "lock: a tick during a run does nothing and exits 0" bash -c "[[ $TICK_RC = 0 && \$(grep -c . '$S/calls.log') = 0 ]]"
  exec 7>&-
  touch "$S/lowdisk"; : >"$S/calls.log"; tick
  check "disk: 10 MB free refuses a backup" bash -c "grep -q 'Levytila' '$S/reports/1.json' && [[ \$(grep -c 'backup.sh ran' '$S/calls.log') = 0 ]]"
}
t_timeout() {
  new_world; touch "$S/hang-restart"; poll restart
  local t0=$SECONDS; tick env OPS_T_RESTART=2
  check "timeout: a hanging action is killed and reported failed" bash -c "[[ \$(( $SECONDS - $t0 )) -lt 40 ]] && grep -q '\"status\":\"failed\"' '$S/reports/1.json'"
}
t_app_down() {
  new_world; rm -f "$S/running"; poll backup; tick
  check "app down: no poll, no action, helper-seen written" bash -c "[[ \$(grep -c 'ops poll' '$S/calls.log') = 0 && -s '$CL/ops/helper-seen' && $TICK_RC = 0 ]]"
}

# ── the other actions, output handling ──────────────────────────────────────
t_actions() {
  new_world; poll backup; tick
  check "backup: ran backup.sh and made the copy in the data volume" bash -c "[[ \$(grep -c 'backup.sh ran' '$S/calls.log') = 1 && \$(grep -c 'SNAPSHOT /data/backups/manual-' '$S/calls.log') = 1 ]]"
  check "backup: reported ok" reported ok
  poll doctor "$ID2"; tick
  check "doctor: ran and reported the findings" bash -c "grep -q '\"status\":\"ok\"' '$S/reports/2.json' && grep -q '\"doctor\":{\"at\"' '$S/reports/2.json'"
  poll restart op_3333333333333333; tick
  check "restart: restarted and waited for health" bash -c "grep -q '^docker compose restart banking' '$S/calls.log' && grep -q '\"status\":\"ok\"' '$S/reports/3.json'"
}
t_scrub() {
  new_world; poll backup; tick
  local r; r=$(cat "$S/reports/1.json")
  check "scrub: ANSI codes gone" bash -c "! grep -q $'\\033' '$S/reports/1.json'"
  check "scrub: long token-like run hidden" bash -c "! grep -q 'abcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuv' '$S/reports/1.json' "
  check "scrub: Authorization and TOKEN lines dropped" bash -c "! grep -qiE 'Authorization|TUNNEL_TOKEN' '$S/reports/1.json'"
  check "scrub: ordinary lines kept" grep -q 'kept line' <<<"$r"
}
t_heartbeat() {
  new_world; release 0.2.0; tick
  check "heartbeat: first tick after boot sends a state snapshot" grep -q '"checked_at"' "$S/state.last"
  check "heartbeat: snapshot has mode and version" grep -qE '"mode":"local".*"version"|"version".*"mode":"local"' "$S/state.last"
  check "heartbeat: no secrets or paths in the snapshot" bash -c "! grep -qE 'PASSWORD|/home|secret' '$S/state.last'"
}
t_no_dangerous_constructs() {
  check "helper: no eval, source, bash -c or sudo" bash -c "! grep -vE '^[[:space:]]*#' '$SRC/scripts/ops-helper.sh' | grep -nE '(^|[;&|(])[[:space:]]*(eval|source)[[:space:]]|bash -c|sudo '"
  check "helper: actions are a case with a refusing default" grep -q '\*) fail "Tuntematon toiminto."' "$SRC/scripts/ops-helper.sh"
  check "installer scheduling: no sudo outside printed hints" bash -c "! grep -vE '^[[:space:]]*#' '$SRC/scripts/lib/ops-schedule.sh' | grep -n 'sudo'"
}

for t in $(declare -F | awk '{print $3}' | grep '^t_'); do
  want "$t" || continue
  echo "── ${t#t_}"
  "$t"
done
echo
echo "$PASS passed, $FAILED failed"
((FAILED == 0))
