#!/usr/bin/env bash
# Tests for tools/release/docker-tidy.sh against a fake docker, timeout, sleep and /proc first in PATH. The fake docker keeps
# a list of images (repository, tag, id, creation time) and of running containers in files; it records every call, and a
# volume, container, system or `image rm` command is recorded as forbidden. The fake sleep adds CPU ticks to the daemons'
# stat files instead of waiting, so a scenario sets the CPU the daemons used in the sample.
#
#   tools/test/docker-tidy.test.sh [name-filter]
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
SRC=$(cd "$HERE/../.." && pwd)
FILTER=${1:-}
PASS=0; FAILED=0
pass() { PASS=$((PASS + 1)); echo "ok   $1"; }
fail() { FAILED=$((FAILED + 1)); echo "FAIL $1"; [[ -z ${2:-} ]] || echo "       $2"; }
check() { local n=$1; shift; if "$@"; then pass "$n"; else fail "$n"; fi; }
want() { [[ -z $FILTER || $1 == *$FILTER* ]]; }

TMPBASE=$(mktemp -d)
trap 'rm -rf "$TMPBASE"' EXIT
N=0 W='' OUT=''

# world: a repository with the script and six baselines (tags b1..b6, one commit each), the stamp of a proof that used b1 b3
# b4 b5 b6, and the stand-ins. The image list starts empty: a scenario fills it with img REPO TAG ID CREATED.
world() {
  N=$((N + 1)); W=$TMPBASE/$N
  mkdir -p "$W/repo/tools/release" "$W/bin" "$W/proc/100" "$W/proc/200"
  cp "$SRC/tools/release/docker-tidy.sh" "$W/repo/tools/release/"
  (cd "$W/repo" && git init -q && for i in 1 2 3 4 5 6; do echo "$i" >f; git add f; git -c user.name=t -c user.email=t@example.invalid commit -q -m "c$i"; git tag "b$i"; done)
  printf '%s\nb1 b3 b4 b5 b6\n' "$(git -C "$W/repo" rev-parse HEAD)" >"$W/stamp"
  : >"$W/images"; : >"$W/running"; : >"$W/calls.log"; : >"$W/forbidden"; : >"$W/timeouts.log"; echo 0 >"$W/dangling"; echo 0 >"$W/bump"
  cat >"$W/bin/docker" <<'STUB'
#!/usr/bin/env bash
W=${TIDY_WORLD:?}
echo "docker $*" >>"$W/calls.log"
row() { awk -F'\t' -v r="${1%%:*}" -v t="${1#*:}" '$1 == r && $2 == t { print $3 }' "$W/images"; }
case ${1:-}:${2:-} in
  ps:*) [[ ! -e $W/ps-hangs ]] || exit 124; sed 's/^/c-/' "$W/running" ;;
  inspect:*) cat "$W/running" ;;
  image:ls) cat "$W/images" ;;
  image:prune)
    n=$(cat "$W/dangling"); echo 0 >"$W/dangling"
    echo "Deleted Images:"; for ((i = 0; i < n; i++)); do echo "deleted: sha256:dangling$i"; done; echo "Total reclaimed space: 0B" ;;
  rmi:*)
    id=$(row "$2"); [[ -n $id ]] || exit 1
    ! grep -qx "$id" "$W/stopped-use" 2>/dev/null || exit 1
    awk -F'\t' -v r="${2%%:*}" -v t="${2#*:}" '!($1 == r && $2 == t)' "$W/images" >"$W/images.new"; mv "$W/images.new" "$W/images" ;;
  volume:* | container:* | system:* | network:* | image:rm | rm:* | stop:* | kill:*) echo "docker $*" >>"$W/forbidden" ;;
esac
exit 0
STUB
  cat >"$W/bin/timeout" <<'STUB'
#!/usr/bin/env bash
echo "timeout $1 $2" >>"${TIDY_WORLD:?}/timeouts.log"
shift; exec "$@"
STUB
  cat >"$W/bin/sleep" <<'STUB'
#!/usr/bin/env bash
W=${TIDY_WORLD:?}
echo "sleep $*" >>"$W/calls.log"
for p in "$W"/proc/*; do
  [[ -f $p/stat ]] || continue
  read -ra f <"$p/stat"; f[13]=$((f[13] + $(cat "$W/bump"))); echo "${f[*]}" >"$p/stat"
done
STUB
  chmod +x "$W/bin/"*
  # pid 100 is dockerd, pid 200 containerd; utime and stime are the 14th and 15th fields
  for p in 100 200; do echo "$p (x) S 1 1 1 0 -1 0 0 0 0 0 5 5 0 0 20 0 1 0 1 1 1" >"$W/proc/$p/stat"; done
}
img() { printf '%s\t%s\t%s\t%s\n' "$1" "$2" "$3" "$4" >>"$W/images"; } # img REPO TAG ID CREATED
tidy() { # tidy [ENV=VALUE]...: the script's output into OUT
  OUT=$(env PATH="$W/bin:$PATH" TIDY_WORLD="$W" DOCKER_TIDY_STAMP="$W/stamp" DOCKER_TIDY_PROC="$W/proc" DOCKER_TIDY_PIDS="100 200" \
    DOCKER_TIDY_SAMPLE=10 "$@" bash "$W/repo/tools/release/docker-tidy.sh" 2>&1)
}
base() { img proof-baseline "$(git -C "$W/repo" rev-parse "$1")" "sha256:base-$1" "2026-10-01 10:00:00 +0000 UTC"; } # base TAG
has() { local t; for t in "$@"; do grep -qF -- "$t" "$W/images" || return 1; done; }   # the image list holds all of these
gone() { local t; for t in "$@"; do ! grep -qF -- "$t" "$W/images" || return 1; done; } # and none of these
said() { grep -qF -- "$1" <<<"$OUT"; }
silent() { ! grep -qF -- "$1" <<<"$OUT"; }
nothing_forbidden() { [[ ! -s $W/forbidden ]]; }
called() { grep -qxF -- "$1" "$W/calls.log"; }
never_called() { ! grep -qE -- "$1" "$W/calls.log"; }
every_call_has_timeout() { # every docker call went through `timeout 60`
  local d t; d=$(grep -c '^docker ' "$W/calls.log"); t=$(grep -c '^timeout 60 docker$' "$W/timeouts.log"); ((d > 0 && d == t))
}
baselines_left() { [[ $(grep -c '^proof-baseline' "$W/images") == "$1" ]]; }

t_images() {
  world
  for b in b1 b2 b3 b4 b5 b6; do base "$b"; done
  img banking-app ci sha256:new "2026-10-16 10:00:00 +0000 UTC"
  img banking-app latest sha256:new "2026-10-16 10:00:00 +0000 UTC"
  img banking-app 0.62.0 sha256:old1 "2026-10-10 10:00:00 +0000 UTC"
  img banking-app 0.61.0 sha256:old2 "2026-10-01 10:00:00 +0000 UTC"
  img banking-app previous sha256:old3 "2026-09-01 10:00:00 +0000 UTC"
  img proof-1 latest sha256:lane1 "2026-10-16 09:00:00 +0000 UTC"
  img caddy 2 sha256:caddy "2026-01-01 10:00:00 +0000 UTC"
  img banking-app-other ci sha256:foreign "2026-01-01 10:00:00 +0000 UTC"
  img proof-baselines x sha256:foreign2 "2026-01-01 10:00:00 +0000 UTC"
  img proof-x latest sha256:foreign3 "2026-01-01 10:00:00 +0000 UTC"
  tidy
  # removed: baseline b2, banking-app 0.62.0 and 0.61.0, proof-1; kept: five baselines, ci, latest, previous
  check "images: one line, removed and kept counted" said "docker: removed 4 images, kept 8"
  check "images: the five baselines of the proof stay" has base-b1 base-b3 base-b4 base-b5 base-b6
  check "images: the sixth baseline goes" gone base-b2
  check "images: the newest build stays under every tag" has $'banking-app\tci\t' $'banking-app\tlatest\t'
  check "images: older builds go" gone 0.62.0 0.61.0
  check "images: a rollback image stays" has $'banking-app\tprevious\t'
  check "images: a proof lane's image goes" gone $'proof-1\t'
  check "images: a foreign image stays, also one whose name only looks like ours" has caddy banking-app-other proof-baselines $'proof-x\t'
  check "images: no volume, container, system or image rm command" nothing_forbidden
  check "images: every docker call has timeout 60" every_call_has_timeout
}

t_running() {
  world
  img banking-app ci sha256:new "2026-10-16 10:00:00 +0000 UTC"
  img banking-app 0.62.0 sha256:used "2026-10-10 10:00:00 +0000 UTC"
  img banking-app 0.61.0 sha256:unused "2026-10-01 10:00:00 +0000 UTC"
  echo "sha256:used" >"$W/running"
  tidy
  check "running: the image of a running container stays" has sha256:used
  check "running: the one no container uses goes" gone sha256:unused
  check "running: counted" said "docker: removed 1 images, kept 2"
  # Docker refuses to remove an image a stopped container was made from: that counts as kept
  world
  img banking-app ci sha256:new "2026-10-16 10:00:00 +0000 UTC"
  img banking-app 0.61.0 sha256:stopped "2026-10-01 10:00:00 +0000 UTC"
  echo "sha256:stopped" >"$W/stopped-use"
  tidy
  check "running: a removal Docker refuses is counted as kept" said "docker: removed 0 images, kept 2"
}

t_guards() {
  world
  img banking-app ci sha256:new "2026-10-16 10:00:00 +0000 UTC"
  img banking-app 0.61.0 sha256:old "2026-10-01 10:00:00 +0000 UTC"
  touch "$W/ps-hangs"
  tidy
  check "no answer: a docker ps that hangs removes nothing" has sha256:old
  check "no answer: and says so" said "no image removed"
  world; rm "$W/stamp"; base b2; base b3
  tidy
  check "no stamp: every baseline image stays" baselines_left 2
  world; printf 'x\nb1 nosuchref\n' >"$W/stamp"; base b2; base b3
  tidy
  check "a stamp ref that names no commit: every baseline image stays" baselines_left 2
  world; base b2; base b3
  tidy
  check "near miss: a stamp that names b3 and not b2 removes only b2" baselines_left 1
  world
  img banking-app ci sha256:new "2026-10-16 10:00:00 +0000 UTC"
  img "<none>" "<none>" sha256:dangling "2026-10-01 10:00:00 +0000 UTC"
  echo 3 >"$W/dangling"
  tidy
  check "dangling images: pruned and counted" said "docker: removed 3 images, kept 1"
  check "dangling images: prune -f only, never -a" called "docker image prune -f"
  check "dangling images: no prune of everything" never_called 'prune -a|prune --all'
}

t_cpu() {
  world; echo 500 >"$W/bump"; tidy
  check "cpu: above 20 % with no container prints the warning with its advice" said "docker: idle at 100 % CPU; restart with sudo systemctl restart containerd docker"
  check "cpu: the sample is 10 s of the daemons' stat files" called "sleep 10"
  check "cpu: no docker system df" never_called 'system'
  world; echo 110 >"$W/bump"; tidy
  check "cpu: 22 % (two daemons, 110 ticks each) is above 20" said "docker: idle at 22 % CPU"
  world; echo 100 >"$W/bump"; tidy
  check "cpu: exactly 20 % is not above it" silent "idle at"
  check "cpu: and the quiet line says what was measured" said "docker: CPU 20 % of one core over 10 s, 0 containers running"
  world; echo 500 >"$W/bump"; echo sha256:used >"$W/running"; tidy
  check "cpu: high with a running container is no warning" silent "idle at"
  world; echo 500 >"$W/bump"; touch "$W/ps-hangs"; tidy
  check "cpu: docker that does not answer and a busy daemon: its own warning" said "docker: no answer and 100 % CPU; restart with sudo systemctl restart containerd docker"
  world; echo 500 >"$W/bump"; tidy DOCKER_TIDY_PIDS=' '
  check "cpu: no daemon process here: nothing sampled, no warning" said "CPU not sampled"
  check "cpu: nothing is restarted" never_called 'restart|systemctl'
}

for t in images running guards cpu; do if want "$t"; then "t_$t"; fi; done
echo "$PASS passed, $FAILED failed"
((FAILED == 0))
