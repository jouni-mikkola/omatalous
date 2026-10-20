#!/usr/bin/env bash
# Tests for scripts/lib/ops-housekeeping.sh: the helper frees Docker's disk before it runs out. The world (clone, ticks, stub
# docker) is tools/test/ops-world.sh; this suite puts a model of an image store, containers and volumes behind the stub docker
# (hk_world), so it can tell what a prune takes and what stays.
#
#   tools/test/ops-housekeeping.test.sh [name-filter]
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
# shellcheck disable=SC2034 # read by ops-world.sh (unprivileged)
SRC=${OPS_TEST_SRC:-$(cd "$HERE/../.." && pwd)}
FILTER=${1:-}
want() { [[ -z $FILTER || $1 == *$FILTER* ]]; }
# shellcheck source=ops-world.sh
. "$HERE/ops-world.sh"
unprivileged ops-housekeeping.test.sh "$@"

# ── the model ───────────────────────────────────────────────────────────────
# $S/hk/img/ID: three lines (tags, label, size in KB) per image; hk/ctr/NAME: the image ID of a container; hk/vol/NAME: a
# volume; hk/cache: KB of build cache. $S/free-kb is what df says Docker's disk has free, and a prune adds what it frees.
# Like the real one, `image prune -f` takes images without a tag that no container (running or not) was made from, and
# `builder prune -f` the cache. A volume, system, container or network command, an image rm and `image prune -a` are recorded
# in $S/forbidden, and the first three really take every volume, so a test sees the damage.
hk_img() { printf '%s\n%s\n%s\n' "$2" "$3" "$4" >"$H/img/$1"; } # hk_img ID TAGS LABEL KB
hk_world() {
  new_world; H=$S/hk; mkdir -p "$H"/{img,ctr,vol}
  mv "$S/bin/docker" "$S/bin/docker.base"
  cat >"$S/bin/docker" <<'EOF'
#!/usr/bin/env bash
S=$OPS_STUB_DIR; H=$S/hk
note() { printf 'docker %s\n' "$*" >>"$S/calls.log"; }
reclaim() { echo $(($(cat "$S/free-kb") + $1)) >"$S/free-kb"; echo "Total reclaimed space: $(($1 / 1024))MB"; }
case ${1:-} in
  volume | system | container | network | rmi) note "$@"; echo "$*" >>"$S/forbidden"; rm -f "$H"/vol/*; exit 0 ;;
esac
case "${1:-} ${2:-}" in
  "image rm") note "$@"; echo "$*" >>"$S/forbidden"; exit 0 ;;
  "image prune")
    note "$@"
    [[ -e $S/prunefail ]] && { echo "prune failed" >&2; exit 1; }
    [[ -e $S/prune-eats-previous ]] && rm -f "$S/images/banking-app_previous"
    [[ -e $S/prune-eats-running ]] && rm -f "$H/img/id-0.1.0"
    all=""; label=""; freed=0
    for a in "$@"; do case $a in -a | --all) all=1; echo "$*" >>"$S/forbidden" ;; label=*) label=${a#label=} ;; esac; done
    for f in "$H"/img/*; do
      [[ -f $f ]] || continue
      id=${f##*/}; { read -r tags; read -r lab; read -r kb; } <"$f"
      [[ -z $tags || -n $all ]] || continue
      [[ -z $label || $lab == "$label" ]] || continue
      grep -qxF "$id" "$H"/ctr/* 2>/dev/null && continue
      rm -f "$f"; freed=$((freed + kb)); echo "Deleted: sha256:$id"
    done
    reclaim "$freed"; exit 0 ;;
  "builder prune")
    note "$@"
    kb=$(cat "$H/cache" 2>/dev/null || echo 0); echo 0 >"$H/cache"; reclaim "$kb"; exit 0 ;;
  "image inspect")
    ref=${@: -1}
    if [[ $ref == id-* ]]; then note "$@"; [[ -f $H/img/$ref ]]; exit $?; fi ;;
esac
exec "$S/bin/docker.base" "$@"
EOF
  cat >"$S/bin/df" <<'EOF'
#!/usr/bin/env bash
printf 'Filesystem 1024-blocks Used Available Capacity Mounted on\nx 900000000 1 %s 1%% /\n' "$(cat "$OPS_STUB_DIR/free-kb")"
EOF
  chmod +x "$S/bin/docker" "$S/bin/df"
  echo 1048576 >"$S/free-kb"; echo 1024000 >"$H/cache"   # 1 GB free; 1500 MB of old image and 1000 MB of cache to free
  echo "0.0.9|$C1|1" >"$S/images/banking-app_previous"   # the image a rollback would need
  hk_img id-0.1.0 banking-app:latest talous.version 50000; echo id-0.1.0 >"$H/ctr/app"   # what the app runs from
  hk_img own-old "" talous.version 1536000                 # an old version of this app: no tag, no container
  hk_img web-1 nginx:1.25 - 200000                         # another project: a tag, no container
  hk_img db-1 postgres:16 - 400000; echo db-1 >"$H/ctr/db" # another project: a tag and a container
  hk_img web-0 "" - 100000; echo web-0 >"$H/ctr/web"       # another project: no tag, but a (stopped) container made from it
  hk_img stray "" - 250000                                 # other software: no tag, no label, no container (the button takes it)
  touch "$H/vol/banking_data" "$H/vol/other_pgdata" "$H/vol/other_web"
}
low() { echo "${1:-1048576}" >"$S/free-kb"; }
due() { rm -f "$CL/ops/last-check"; } # the daily block runs in the next tick
prunes() { n_calls '^docker image prune -f'; }
filtered() { n_calls '^docker image prune -f --filter label=talous.version *$'; }
plain() { n_calls '^docker image prune -f *$'; }
caches() { n_calls '^docker builder prune -f *$'; }
hk_lines() { grep -c 'housekeeping:' "$CL/ops/helper.log" 2>/dev/null || true; }
hk_line() { grep 'housekeeping:' "$CL/ops/helper.log" 2>/dev/null | tail -1 || true; }
line_has() { # exactly one housekeeping line, holding every argument
  local l f
  [[ $(hk_lines) = 1 ]] || return 1
  l=$(hk_line); for f in "$@"; do [[ $l == *"$f"* ]] || return 1; done
}
# a docker call that could take a volume, a container, another project's image or a tagged image
bad_calls() { calls | grep -E '^docker (volume|system|container|network|rmi)|^docker image (rm|prune .*(-a|--all))|--volumes|^docker compose down' || true; }
volumes_stay() { [[ -e $H/vol/banking_data && -e $H/vol/other_pgdata && -e $H/vol/other_web ]]; }
others_stay() { [[ -f $H/img/web-1 && -f $H/img/db-1 && -f $H/img/web-0 && -f $H/ctr/db && -f $H/ctr/web && -f $H/ctr/app ]]; }
hk_call() { # hk_call CODE: CODE runs in the helper's own context in the clone, with main replaced
  sed 's/^main$/eval "$HK_CALL"/' "$CL/scripts/ops-helper.sh" >"$CL/scripts/hk-call.sh"; chmod 755 "$CL/scripts/hk-call.sh"
  (cd "$CL" && env TALOUS_OPS_CLEAN=1 OPS_TEST=1 OPS_STUB_DIR="$S" HOME="$W/home" PATH="$S/bin:/usr/local/bin:/usr/bin:/bin" HK_CALL="$1" ./scripts/hk-call.sh >"$W/hk-call.out" 2>&1)
  rm -f "$CL/scripts/hk-call.sh"
}

# ── when it prunes ──────────────────────────────────────────────────────────
t_prune_under_3gb() {
  hk_world; low; tick
  check "under 3 GB: one image prune with the label filter ran, and no cache prune" test "$(filtered)" = 1 -a "$(prunes)" = 1 -a "$(caches)" = 0
  check "under 3 GB: this app's old image is gone" test ! -e "$H/img/own-old"
  check "under 3 GB: one line in helper.log says what was free before and after" test "$(hk_lines)" = 1 -a "$(hk_line | cut -d' ' -f2-)" = "housekeeping: Docker's disk ($S/root) had 1024 MB free; pruned this app's old images; now 2524 MB free"
  check "under 3 GB: the time of the try is written (seconds)" bash -c "[[ \$(cat '$CL/ops/housekeeping-at') =~ ^[0-9]{10}\$ ]]"
  check "under 3 GB: no volume, container, network, system or tagged-image command" test -z "$(bad_calls)" -a ! -e "$S/forbidden"
  check "under 3 GB: no temporary log is left, and the installer's lock is free again" bash -c "[[ -z \$(ls '$CL/ops/run' | grep housekeeping) ]] && flock -n '$CL/scripts/install.sh' true"
  hk_world; low 3145727; tick
  check "under 3 GB: one KB under the limit prunes" test "$(prunes)" = 1
}
t_no_prune_with_space() {
  local kb
  for kb in 3145728 6000000; do
    hk_world; low "$kb"; tick
    check "with space ($kb KB): nothing is pruned, written or logged" test "$(prunes)" = 0 -a "$(caches)" = 0 -a "$(hk_lines)" = 0 -a ! -e "$CL/ops/housekeeping-at" -a -f "$H/img/own-old"
  done
  hk_world; low 100; rm -rf "$S/root"; tick
  check "no Docker directory to measure: nothing is pruned" test "$(prunes)" = 0 -a "$(hk_lines)" = 0
}
t_prune_rate_limited() {
  local now
  hk_world; low; tick; low; due; tick
  check "rate: a second try at once does nothing" test "$(prunes)" = 1 -a "$(hk_lines)" = 1
  now=$(date +%s); echo $((now - 5 * 3600)) >"$CL/ops/housekeeping-at"; low; due; tick
  check "rate: five hours after the last one does nothing" test "$(prunes)" = 1
  echo $((now - 6 * 3600 - 10)) >"$CL/ops/housekeeping-at"; low; due; tick
  check "rate: six hours after the last one prunes again, and moves the time" test "$(prunes)" = 2 -a "$(hk_lines)" = 2 -a "$(cat "$CL/ops/housekeeping-at")" -ge "$now"
  echo $((now + 86400)) >"$CL/ops/housekeeping-at"; low; due; tick
  check "rate: a time in the future (the clock went back) holds nothing back" test "$(prunes)" = 3
  echo yesterday >"$CL/ops/housekeeping-at"; low; due; tick
  check "rate: something that is not a time holds nothing back" test "$(prunes)" = 4
  hk_world; low; touch "$S/prunefail"; tick; rm -f "$S/prunefail"; low; due; tick
  check "rate: a prune that failed counts as a try" test "$(prunes)" = 1
}

# ── what stays ──────────────────────────────────────────────────────────────
t_prune_keeps_previous() {
  local prev latest
  hk_world; low; prev=$(cat "$S/images/banking-app_previous"); latest=$(cat "$S/images/banking-app_latest"); tick
  check "previous: the prune ran" test "$(prunes)" = 1 -a ! -e "$H/img/own-old"
  check "previous: :previous is the same image (the rollback has it)" test "$(cat "$S/images/banking-app_previous")" = "$prev"
  check "previous: :latest is the same image" test "$(cat "$S/images/banking-app_latest")" = "$latest"
  hk_world; low; touch "$S/prune-eats-previous"; tick
  check "previous: a prune that took it is one failed line, not a success" line_has 'the prune failed (exit 1: Siivous poisti version' 
}
t_prune_keeps_others() {
  hk_world; low; tick
  check "others: the prune ran" test "$(prunes)" = 1 -a ! -e "$H/img/own-old"
  check "others: another project's tagged image, its container and the image of its stopped container stay" others_stay
  check "others: every volume stays (the app's data and the others')" volumes_stay
  check "others: no command that could take them was run" test -z "$(bad_calls)" -a ! -e "$S/forbidden"
  check "others: the app's own container is not stopped or recreated" test "$(n_calls '^docker compose (stop|down|up|restart|rm)')" = 0
}
t_prune_keeps_running() {
  hk_world; low
  echo "0.2.0|$C1|1" >"$S/images/banking-app_latest"; hk_img id-0.1.0 "" talous.version 50000   # an update that did not take: the app still runs from an image with no tag
  tick
  check "running: the prune ran" test "$(prunes)" = 1 -a ! -e "$H/img/own-old"
  check "running: the image the app runs from stays, tag or none" test -f "$H/img/id-0.1.0"
  check "running: and the line says the prune went well" line_has "pruned this app's old images" 
  hk_world; low; touch "$S/prune-eats-running"; tick
  check "running: a prune that took it is one failed line" line_has 'the prune failed (exit 1: Siivous poisti k' 
}
t_prune_failed_one_line() {
  hk_world; low; touch "$S/prunefail"; tick
  check "failed: image prune failed: one line with the exit code, the reason and the space before and after" line_has 'had 1024 MB free; the prune failed (exit 1: ' 'prune failed); now 1024 MB free'
  check "failed: the cache prune did not run" test "$(caches)" = 0
  check "failed: and nothing of the others was touched" others_stay
  check "failed: no volume either" volumes_stay
}

t_prune_own_only() { # the helper's own job is for this app's images; what other software left is not its to take
  hk_world; low; tick
  check "own: an untagged old image of this app goes" test ! -e "$H/img/own-old"
  check "own: another software's untagged, unused image stays" test -f "$H/img/stray"
  check "own: the build cache stays, and is not even asked for" test "$(cat "$H/cache")" = 1024000 -a "$(caches)" = 0
  check "own: the line counts the images only (1024 to 2524 MB)" line_has 'had 1024 MB free; pruned this app' 'now 2524 MB free'
  check "own: the rest of the others stays" others_stay
}
t_prune_button_unchanged() { # the Siivoa button (a prune request) keeps its two plain commands
  hk_world; poll prune; tick
  check "button: the request is reported ok, with the images and the cache in its text" reported ok
  check "button: image prune -f has no filter, and builder prune -f ran" test "$(plain)" = 1 -a "$(filtered)" = 0 -a "$(caches)" = 1
  check "button: untagged images without the label go, and this app's old one, and the cache" bash -c "[[ ! -e '$H/img/stray' && ! -e '$H/img/own-old' && \$(cat '$H/cache') = 0 ]]"
  check "button: the summary names images and the cache" grep -F 'välimuistista' "$S/reports/1.json" >/dev/null
  check "button: what a container uses, what has a tag and every volume stay" others_stay
  check "button: no volume, container or system command" test -z "$(bad_calls)" -a ! -e "$S/forbidden"
  check "button: nothing is written to the housekeeping log" test "$(hk_lines)" = 0 -a ! -e "$CL/ops/housekeeping-at"
}

# ── when it does nothing ────────────────────────────────────────────────────
t_prune_not_during_request() {
  local lockpid
  hk_world; low; poll doctor; tick
  check "request: the request ran" reported ok
  check "request: and nothing was pruned, written or logged in that tick" test "$(prunes)" = 0 -a "$(hk_lines)" = 0 -a ! -e "$CL/ops/housekeeping-at"
  mkdir -p "$CL/ops/run"; : >"$S/calls.log"
  hk_call 'load_libs; LOGF=$OPS/run/op_x.log; housekeeping'
  check "request: an action running in the process holds it back" test "$(prunes)" = 0 -a ! -e "$CL/ops/housekeeping-at"
  hk_call 'load_libs; housekeeping'
  check "request: the same call without an action prunes (the check above is not vacuous)" test "$(prunes)" = 1
  hk_world; low
  ( exec 9<"$CL/scripts/install.sh"; flock 9 && exec sleep 60 ) & lockpid=$! # waits: the poll below takes the lock for a moment, and a holder that does not wait could lose it for good
  for _ in $(seq 50); do flock -n "$CL/scripts/install.sh" true || break; sleep 0.1; done
  tick
  check "lock: the installer's lock is held: nothing is pruned, written or logged" test "$(prunes)" = 0 -a "$(hk_lines)" = 0 -a ! -e "$CL/ops/housekeeping-at" -a -f "$H/img/own-old"
  kill "$lockpid"; wait "$lockpid" 2>/dev/null; due; tick
  check "lock: once it is free the next daily block prunes (the held lock did not count as a try)" test "$(prunes)" = 1 -a "$(hk_lines)" = 1
}

for t in $(declare -F | awk '{print $3}' | grep '^t_'); do
  want "$t" || continue
  echo "── ${t#t_}"
  "$t"
done
echo
echo "$PASS passed, $FAILED failed"
((FAILED == 0))
