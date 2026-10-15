#!/usr/bin/env bash
# shellcheck shell=bash disable=SC2034
# The world of the maintenance helper's shell suites: ops-helper.test.sh and the suite of each lib under
# scripts/lib/ops-*.sh. Sourced by them, not a suite of its own (check.sh runs *.test.sh). Stubs for docker, cosign,
# curl, date (the real one until a suite sets a clock), df, crontab, systemctl, loginctl, sleep and sync, a bare git remote, and a clone with the helper. Nothing here
# touches the network, a real container or a real registry.
#
# The caller sets HERE (the folder of tools/test), SRC (the repository) and FILTER, defines `want` the way every suite
# does (check.sh splits a suite by it), sources this file and calls `unprivileged SUITE "$@"` first: the helper refuses
# root, so a root run copies the scripts and tools/test and runs the suite again as nobody. The refusal itself is
# checked first.
#
# A world is a folder with the stub folder S, a bare remote, a seed to commit releases from and the clone CL (new_world).
# The scenarios drive it with setenv, poll, tick, release, src_commit and read it with calls, report and the counters.
umask 022
PASS=0; FAILED=0
pass() { PASS=$((PASS + 1)); echo "ok   $1"; }
fail() { FAILED=$((FAILED + 1)); echo "FAIL $1"; [[ -z ${2:-} ]] || echo "       $2"; }
check() { # check NAME CMD...
  local n=$1; shift
  if "$@"; then pass "$n"; else fail "$n"; fi
}

unprivileged() { # unprivileged SUITE ARGS...
  local suite=$1 base out rc rootfail=0; shift
  [[ $EUID -eq 0 && -z ${OPS_TEST_CHILD:-} ]] || return 0
  base=$(mktemp -d); chmod 755 "$base"
  mkdir -p "$base/src/tools"; cp -r "$SRC/scripts" "$SRC/docker-compose.yml" "$base/src/"; cp -r "$SRC/tools/test" "$base/src/tools/"
  chown -R 65534:65534 "$base"
  out=$(cd "$base/src" && TALOUS_OPS_CLEAN="" ./scripts/ops-helper.sh 2>&1); rc=$?
  if [[ $rc -ne 0 && $out == *"does not run as root"* ]]; then echo "ok   helper refuses to run as root"
  else echo "FAIL helper refuses to run as root (rc $rc: $out)"; rootfail=1; fi
  setpriv --reuid=65534 --regid=65534 --clear-groups env -u TMPDIR HOME="$base" OPS_TEST_CHILD=1 OPS_TEST_SRC="$base/src" bash "$base/src/tools/test/$suite" "$@"
  rc=$?
  rm -rf "$base"
  exit $((rc || rootfail))
}

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
printf -v line '%s ' "$@"; line=${line//$'\n'/ }; printf 'docker %s\n' "${line:0:420}" >>"$S/calls.log"
key() { printf '%s' "${1//[\/:@]/_}"; }
ver_of() { local v; [[ -f $S/images/$(key "$1") ]] && { IFS='|' read -r v _ <"$S/images/$(key "$1")"; printf '%s\n' "$v"; }; }
healthy() { [[ -e $S/running ]] && [[ ! -e $S/bad_$(cat "$S/cver" 2>/dev/null) ]]; }
last_arg() { eval "printf '%s' \"\${$#}\""; }
case ${1:-} in
  info) [[ $* == *DockerRootDir* ]] && echo "$S/root"; exit 0 ;;
  version) echo 27.0.0; exit 0 ;;
  volume) echo vol; exit 0 ;;
  builder)
    [[ ${2:-} == prune ]] || exit 0
    [[ -e $S/prunefail ]] && { echo "prune failed" >&2; exit 1; }
    echo "Total reclaimed space: $(cat "$S/prune-cache" 2>/dev/null || echo 0B)"; exit 0 ;;
  inspect)
    case $* in *RestartCount*) echo 0 ;; *.Image*) echo "id-$(cat "$S/cver" 2>/dev/null)" ;; esac; exit 0 ;;
  run)
    # the rollback asks the previous image whether it opens the live database as it is: its migrate-check on the data volume
    case $* in *"migrate-check /data/banking.db"*)
      echo "PREVIOUS_CHECK $*" >>"$S/calls.log"
      [[ -e $S/previous-hang ]] && exec /bin/sleep 1000
      code=0; [[ -e $S/previous-check ]] && code=$(cat "$S/previous-check")
      # an answer of 0 comes with the check's JSON line, and by default with nothing to apply
      if [[ $code == 0 && ! -e $S/previous-nojson ]]; then
        printf '{"ok":true,"file":"/data/banking.db","elapsed_ms":5,"migrate_ms":0,"from":10,"to":10,"applied":%s,"ahead":["0010_x.sql"],"integrity":"ok","foreign_key_violations":{"before":0,"after":0},"tables":{},"problems":[]}\n' "$(cat "$S/previous-applied" 2>/dev/null || echo '[]')"
        echo "migrate-check: ok, nothing to apply in 5 ms (migrating took 0 ms). /data/banking.db was not changed." >&2
      fi
      exit "$code" ;; esac
    # update.sh asks the new image whether it has migrate-check: its usage answer is exit code 2, an older image fails otherwise
    case $* in *migrate-check*) echo "DETECT migrate-check" >>"$S/calls.log"; [[ -e $S/no-migrate-check ]] && exit 1; exit 2 ;; esac
    exit 0 ;;
  pull)
    [[ -e $S/pullfail ]] && exit 1
    v=${2##*:}; [[ -f $S/registry/$v ]] || exit 1
    cp "$S/registry/$v" "$S/byid/$v"; cp "$S/registry/$v" "$S/images/$(key "$2")"; cp "$S/registry/$v" "$S/images/$(key "$REG_IMG@sha256:$(printf %s "$v" | sha256sum | cut -c1-64)")"
    echo pulled; exit 0 ;;
  image)
    case ${2:-} in
      prune)
        [[ -e $S/prunefail ]] && { echo "prune failed" >&2; exit 1; }
        # a prune that wrongly takes the previous image, for the safety check
        [[ -e $S/prune-eats-previous ]] && rm -f "$S/images/banking-app_previous"
        echo "Deleted Images:"; echo "Total reclaimed space: $(cat "$S/prune-images" 2>/dev/null || echo 0B)"; exit 0 ;;
      tag)
        # an image ID ("id-<version>", what docker inspect gives for a container) names an image whatever tags it has lost
        if [[ $3 == id-* ]]; then [[ -f $S/byid/${3#id-} ]] || exit 1; cp "$S/byid/${3#id-}" "$S/images/$(key "$4")"; exit 0; fi
        [[ -f $S/images/$(key "$3") ]] || exit 1; cp "$S/images/$(key "$3")" "$S/images/$(key "$4")"; exit 0 ;;
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
          *"--status running"*)
            # caddy and tunnel run only when a test says so
            case $(last_arg "$@") in caddy | tunnel) [[ -e $S/running && -e $S/svc-$(last_arg "$@") ]] && echo cid1 ;; *) [[ -e $S/running ]] && echo cid1 ;; esac ;;
          *) [[ -e $S/container ]] && echo cid1 ;;
        esac; exit 0 ;;
      exec)
        [[ -e $S/running ]] || exit 1
        case $* in
          *wget*) healthy; exit $? ;;
          *"ops poll"*) if [[ -f $S/poll ]]; then cat "$S/poll"; [[ -e $S/poll-keep ]] || rm -f "$S/poll"; else echo '{"request":null}'; fi; exit 0 ;;
          *"ops report"*) n=$(ls "$S/reports" | wc -l); cat >"$S/reports/$((n + 1)).json"; echo '{"ok":true}'; exit 0 ;;
          *"ops state"*) cat >"$S/state.last"; echo '{"ok":true}'; exit 0 ;;
          # the helper's step for the page (step_tell): the line it was given goes to calls.log. progress-refuse is an app that
          # does not know the command (usage line, exit 1) and progress-hang one that never answers
          *"ops progress"*)
            [[ ! -e /proc/$$/fd/8 ]] || echo "LOCK-FD-LEAKED" >>"$S/calls.log"
            [[ -e $S/progress-hang ]] && exec /bin/sleep 1000
            echo "PROGRESS $(cat)" >>"$S/calls.log"
            [[ -e $S/progress-refuse ]] && { echo "Usage: ops poll" >&2; exit 1; }
            echo '{"ok":true}'; exit 0 ;;
          *"dist/node.js version"*) echo "$(cat "$S/cver") (test)"; exit 0 ;;
          # update.sh compares the migration names of the live database with the pre-update copy
          *group_concat*) [[ -e $S/schema-fail ]] && exit 1; echo "SCHEMA_CHECK $(last_arg "$@")" >>"$S/calls.log"; if [[ -e $S/schema-changed ]]; then echo yes; else echo no; fi; exit 0 ;;
          # the helper's wait for a press (wake_wait). The file $S/wake stands for the app's /data/ops/wake: there, it answers 0 and
          # takes it away (wake-keep leaves it, poll-after-wake becomes the next poll); not there, it waits OPS_T_WAKE seconds for it
          # (none unless a suite sets them, so no other suite waits) and answers 1. wake-hang is a client that never answers.
          *"/data/ops/wake"*)
            [[ ! -e /proc/$$/fd/8 ]] || echo "LOCK-FD-LEAKED" >>"$S/calls.log" # the helper's lock must not reach the client
            [[ -e $S/wake-hang ]] && exec /bin/sleep 1000
            for ((i = 0; i < ${OPS_T_WAKE:-0} * 5; i++)); do [[ -e $S/wake ]] && break; /bin/sleep 0.2; done
            [[ -e $S/wake ]] || exit 1
            [[ -e $S/wake-keep ]] || rm -f "$S/wake"
            [[ ! -f $S/poll-after-wake ]] || mv "$S/poll-after-wake" "$S/poll"
            exit 0 ;;
          *" -e "*) [[ -e $S/fail-snapshot ]] && exit 1; echo "SNAPSHOT $(last_arg "$@")" >>"$S/calls.log"; echo same; exit 0 ;;
        esac; exit 0 ;;
      run)
        case $* in
          *migrate-check*)
            echo "MIGRATE_CHECK $(last_arg "$@")" >>"$S/calls.log"
            [[ -e $S/migrate-hang ]] && exec /bin/sleep 1000
            # the container itself failed (docker error, out of memory): no JSON, a code other than the check's own 1
            [[ -e $S/migrate-crash ]] && { echo "docker: Error response from daemon: boom" >&2; exit "$(cat "$S/migrate-crash")"; }
            if [[ -e $S/migrate-fail ]]; then
              printf '{"ok":false,"file":"%s","elapsed_ms":40,"migrate_ms":10,"from":8,"to":8,"applied":[],"ahead":[],"integrity":"ok","foreign_key_violations":{"before":0,"after":0},"tables":{},"problems":["migration 0010_x.sql failed: boom"]}\n' "$(last_arg "$@")"
              echo "migrate-check failed: migration 0010_x.sql failed: boom" >&2; exit 1
            fi
            printf '{"ok":true,"file":"%s","elapsed_ms":%s,"migrate_ms":10,"from":8,"to":9,"applied":["0009_x.sql"],"ahead":[],"integrity":"ok","foreign_key_violations":{"before":0,"after":0},"tables":{},"problems":[]}\n' "$(last_arg "$@")" "$(cat "$S/migrate-ms" 2>/dev/null || echo 40)"
            echo "migrate-check: ok, 1 migration applied to a copy in 40 ms (migrating took 10 ms). The file was not changed." >&2
            exit 0 ;;
          *"copy unusable"*)
            # the rollback's check of the copy (DBCHECK_JS)
            [[ -e $S/snapshot-bad ]] && { echo "database copy unusable: it failed quick_check" >&2; exit 1; }
            echo "DBCHECK $(last_arg "$@")" >>"$S/calls.log"; exit 0 ;;
          *group_concat*)
            # the rollback's choice: the database still has the old schema ("same"), or a copy has to be restored
            if [[ -e $S/restore-needed ]]; then echo "restore $(last_arg "$@")"; else echo same; fi; exit 0 ;;
          *"--entrypoint node"*) [[ -e $S/fail-snapshot ]] && exit 1; echo "SNAPSHOT $(last_arg "$@")" >>"$S/calls.log"; echo same; exit 0 ;;
        esac; exit 0 ;;
      build)
        [[ -e $S/failbuild ]] && { echo "build failed: boom" >&2; exit 1; }
        echo "${APP_VERSION:-?}|${GIT_COMMIT:-?}|1" >"$S/images/$(key banking-app:latest)"; cp "$S/images/$(key banking-app:latest)" "$S/byid/${APP_VERSION:-?}"; exit 0 ;;
      up)
        [[ -e $S/failup ]] && exit 1
        touch "$S/running" "$S/container"; v=$(ver_of banking-app:latest); echo "$v" >"$S/cver"; exit 0 ;;
      stop) rm -f "$S/running"; exit 0 ;;
      start) touch "$S/running"; exit 0 ;;
      restart) [[ -e $S/hang-restart ]] && exec /bin/sleep 1000; exit 0 ;;
      logs)
        n=150; [[ $* == *"--tail "* ]] && n=$(sed -E 's/.*--tail ([0-9]+).*/\1/' <<<"$*")
        svc=$(last_arg "$@")
        for ((i = 1; i <= n + 50; i++)); do echo "$svc-1  | line $i of $svc"; done | tail -n "$n"
        echo "$svc-1  | call with Bearer abc123tokenvalue ok"
        echo "$svc-1  | session eyJhbGciOiJSUzI1NiJ9.eyJ4IjoxfQ.c2ln done"
        echo "$svc-1  | TUNNEL_TOKEN=abc"
        echo "$svc-1  | api_key=zzz"
        echo "$svc-1  | kept log line"
        exit 0 ;;
      down|pull) exit 0 ;;
    esac; exit 0 ;;
esac
exit 0
EOF
  sed -i "s#^S=\$OPS_STUB_DIR#S=\$OPS_STUB_DIR; REG_IMG=$REG#" "$b/docker"
  cat >"$b/cosign" <<'EOF'
#!/usr/bin/env bash
printf 'cosign %s\n' "$*" >>"$OPS_STUB_DIR/calls.log"
[[ -e $OPS_STUB_DIR/cosignfail ]] && exit 1
[[ $* == *"--certificate-oidc-issuer https://token.actions.githubusercontent.com"* && $* == *"release\\.yml@refs/(tags/v"* && $* == *"@sha256:"* ]] || exit 1
# the trigger of the run that signed the stub image: a push unless a test says otherwise
by=$(cat "$OPS_STUB_DIR/signed-by" 2>/dev/null || echo push)
[[ $* == *"--certificate-github-workflow-sha "????????????????????????????????????????" "* && $* == *"--certificate-github-workflow-trigger $by "* ]] || exit 1
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
  # scheduling: a crontab kept in a file, and systemd only when a test asks for it
  cat >"$b/crontab" <<'EOF'
#!/usr/bin/env bash
f=$OPS_STUB_DIR/crontab
case ${1:-} in -l) [[ -s $f ]] && cat "$f"; exit 0 ;; -r) rm -f "$f"; exit 0 ;; -) cat >"$f"; exit 0 ;; esac
exit 1
EOF
  cat >"$b/systemctl" <<'EOF'
#!/usr/bin/env bash
[[ -e $OPS_STUB_DIR/systemd ]] || exit 1
printf 'systemctl %s\n' "$*" >>"$OPS_STUB_DIR/calls.log"
exit 0
EOF
  printf '#!/bin/sh\n[ -e "$OPS_STUB_DIR/systemd" ] && echo yes\nexit 0\n' >"$b/loginctl"
  printf '#!/bin/sh\nexec /bin/sleep 0.01\n' >"$b/sleep"
  # The test's clock. A world has the real `date` until a scenario calls set_clock: stub/clock holds epoch seconds, this
  # `date` answers that time, and only `later` moves it. A call that names its own time (-d) is the real date. The file
  # is found by the stub's own place: the helper also runs commands with an empty environment.
  cat >"$b/date" <<'EOF'
#!/bin/bash
c=${0%/*}/../clock
[[ -e $c ]] || exec /bin/date "$@"
for a in "$@"; do case $a in -d* | --date*) exec /bin/date "$@" ;; esac; done
read -r t <"$c"; exec /bin/date -d "@$t" "$@"
EOF
  # sync only records what it was asked to flush (and fails when a test says so)
  printf '#!/bin/sh\necho "sync $*" >>"$OPS_STUB_DIR/calls.log"\n[ -e "$OPS_STUB_DIR/sync-fail" ] && exit 1\n[ -e "$OPS_STUB_DIR/sync-fail-paths" ] && [ $# -gt 0 ] && exit 1\nexit 0\n' >"$b/sync"
  chmod +x "$b"/*
}

# a world: stub state, a bare remote with one commit (0.1.0), a clone with the helper, a running 0.1.0
# The git work (init, two clones, a commit, a push) is most of the cost, so it is done once per suite process, into a
# template; every scenario gets a copy. The copy is a whole, separate world: the one place the template's own path is
# written is rewritten (the clones' origin and ops/policy point at the remote).
new_world() {
  if [[ -z ${WORLD_T:-} ]]; then build_world "$(mktemp -d "$TMPBASE/t.XXXXXX")"; WORLD_T=$W; WORLD_C1=$C1; fi
  W=$(mktemp -d "$TMPBASE/w.XXXXXX"); cp -a "$WORLD_T/." "$W/"
  sed -i "s|$WORLD_T|$W|g" "$W/clone/ops/policy" "$W/clone/.git/config" "$W/seed/.git/config" "$W"/clone/.git/logs/HEAD "$W"/clone/.git/logs/refs/heads/main "$W"/clone/.git/logs/refs/remotes/origin/HEAD
  S=$W/stub; CL=$W/clone; C1=$WORLD_C1
}
build_world() { # build_world DIR: the template
  W=$1; S=$W/stub
  mkdir -p "$S"/{bin,images,registry,reports,root,byid} "$W/home"
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
  echo "0.1.0|$C1|1" >"$S/images/$(printf %s banking-app:latest | tr '/:@' '___')"; cp "$S/images/banking-app_latest" "$S/byid/0.1.0"
  touch "$S/running" "$S/container"; echo 0.1.0 >"$S/cver"; : >"$S/calls.log"
  echo 200 >"$S/release.status"
}
T0=1767268800 # 2026-01-01T12:00:00Z, where a suite that sets a clock starts it
set_clock() { echo "${1:-$T0}" >"$S/clock"; }
later() { set_clock $(($(cat "$S/clock") + $1)); } # later SECONDS: time passes (a negative number is a clock that steps back)
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
