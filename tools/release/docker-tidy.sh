#!/usr/bin/env bash
# Docker housekeeping after a proof, run by the release cut after the release (it never fails a release: exit 0 always):
#
#   tools/release/docker-tidy.sh
#
# 1. Removes this app's images that no proof needs, and says "docker: removed N images, kept M". This app's repositories are
#    banking-app, proof-baseline (the kept baseline images of tools/ci/local-proof.sh) and proof-<n> (a proof lane's install).
#    Kept: the newest banking-app build, the proof-baseline images of the baselines the last green proof used (named in its
#    stamp; with no readable stamp every baseline image stays), banking-app:previous and :pending-previous (an install's
#    rollback), and every image a running container uses (any tag of its ID). Nothing else is touched: no foreign image, no
#    volume, no container. Dangling images go with `docker image prune -f`. A removal that Docker refuses counts as kept.
#    When Docker cannot say which containers run, nothing is removed.
# 2. Samples the CPU time of dockerd and containerd for DOCKER_TIDY_SAMPLE seconds (default 10) from /proc/<pid>/stat, never
#    `docker system df`, which hangs with many images. Above DOCKER_TIDY_IDLE_PCT percent (default 20) of one core with no
#    running container it prints "docker: idle at X % CPU", then "restart with sudo systemctl restart containerd docker".
#    It never restarts anything.
# Every docker call has `timeout 60`. Test hooks: DOCKER_TIDY_STAMP, DOCKER_TIDY_PROC, DOCKER_TIDY_PIDS.
set -uo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)
SAMPLE=${DOCKER_TIDY_SAMPLE:-10}
LIMIT=${DOCKER_TIDY_IDLE_PCT:-20}
PROC=${DOCKER_TIDY_PROC:-/proc}
STAMP=${DOCKER_TIDY_STAMP:-$(git -C "$ROOT" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)/local-proof}
TAB=$'\t'
d() { timeout 60 docker "$@"; }

command -v docker >/dev/null 2>&1 || { echo "docker: not installed, nothing to tidy"; exit 0; }

# WANT: the commits of the refs the last green proof used, space-bounded; ' ' when the stamp says nothing usable
WANT=' '
if [[ -f $STAMP ]]; then
  for ref in $(sed -n 2p "$STAMP"); do
    c=$(git -C "$ROOT" rev-parse --verify -q "$ref^{commit}") || { WANT=' '; break; }
    WANT+="$c "
  done
fi

removed=0 kept=0 running=-1 ids=''
if ids=$(d ps -q 2>/dev/null); then
  running=0
  [[ -z $ids ]] || running=$(wc -l <<<"$ids")
fi
USED=' '
# shellcheck disable=SC2086 # one word per container id
[[ -z $ids ]] || USED+="$(d inspect --format '{{.Image}}' $ids 2>/dev/null | tr '\n' ' ') "

if ((running < 0)); then
  echo "docker: no answer to docker ps within 60 s, no image removed"
elif rows=$(d image ls --no-trunc --format "{{.Repository}}${TAB}{{.Tag}}${TAB}{{.ID}}${TAB}{{.CreatedAt}}" 2>/dev/null); then
  # the newest banking-app build: the ID of the row with the latest creation time
  newest=$(awk -F'\t' '$1 == "banking-app" { print $4 "\t" $3 }' <<<"$rows" | sort -r | head -1 | cut -f2)
  while IFS=$'\t' read -r repo tag id _; do
    [[ $repo == banking-app || $repo == proof-baseline || $repo =~ ^proof-[0-9]+$ ]] || continue
    [[ $tag != '<none>' ]] || continue
    keep=0
    if [[ $USED == *" $id "* ]]; then keep=1
    elif [[ $repo == banking-app ]]; then
      [[ $id == "$newest" || $tag == previous || $tag == pending-previous ]] && keep=1
    elif [[ $repo == proof-baseline ]]; then
      [[ $WANT == ' ' || $WANT == *" $tag "* ]] && keep=1
    fi
    if ((keep)); then kept=$((kept + 1))
    elif d rmi "$repo:$tag" >/dev/null 2>&1; then removed=$((removed + 1))
    else kept=$((kept + 1)); fi
  done <<<"$rows"
  if out=$(d image prune -f 2>/dev/null); then removed=$((removed + $(grep -c '^deleted: ' <<<"$out")))
  fi
  echo "docker: removed $removed images, kept $kept"
else
  echo "docker: no answer to docker image ls within 60 s, no image removed"
fi

# ticks: the CPU time of the daemons in clock ticks (utime + stime)
ticks() {
  local p s t=0 f
  for p in $PIDS; do
    s=$(cat "$PROC/$p/stat" 2>/dev/null) || continue
    read -ra f <<<"${s##*) }" # after the command name: state is field 1, utime 12, stime 13
    t=$((t + ${f[11]:-0} + ${f[12]:-0}))
  done
  echo "$t"
}
PIDS=${DOCKER_TIDY_PIDS-$(pidof dockerd containerd 2>/dev/null)}
if [[ -z ${PIDS// /} ]]; then echo "docker: CPU not sampled, no dockerd or containerd process here"; exit 0; fi
hz=$(getconf CLK_TCK 2>/dev/null || echo 100)
t1=$(ticks); sleep "$SAMPLE"; t2=$(ticks)
((t2 > t1)) || t2=$t1
pct=$(((t2 - t1) * 100 / (hz * SAMPLE)))
if ((pct > LIMIT && running == 0)); then
  echo "docker: idle at $pct % CPU; restart with sudo systemctl restart containerd docker"
elif ((pct > LIMIT && running < 0)); then
  echo "docker: no answer and $pct % CPU; restart with sudo systemctl restart containerd docker"
else
  echo "docker: CPU $pct % of one core over $SAMPLE s, $((running < 0 ? 0 : running)) containers running"
fi
exit 0
