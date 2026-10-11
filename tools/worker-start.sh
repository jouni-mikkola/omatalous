#!/usr/bin/env bash
# The first command of a worker task: puts the worktree on the base commit and prepares what the task needs.
#   tools/worker-start.sh <base> <task>
# Refuses a tree with changes. Fast-forwards HEAD to <base> (a sha or a ref; refuses when that is not a fast-forward),
# runs `pnpm install --frozen-lockfile --offline` when node_modules is missing, makes a private scratch folder
# $WORKER_SCRATCH/<task> (default /tmp/claude-0/work) and prints it with the brief. The base is also recorded, so
# `pnpm check --changed` knows what the diff is against and `tools/lead/land.sh` where the revert guard starts.
# The brief (.claude/plan/*/<task>.md in the base) may say `After: U1 S1`: the base must then hold a commit "U1: ..."
# and one "S1: ...", or nothing moves. Its `Owns:` line is printed.
set -euo pipefail
cd "$(dirname "$0")/.."

die() { echo "worker-start: $*" >&2; exit 1; }
(($# == 2)) || die "usage: tools/worker-start.sh <base> <task>"
base=$1 task=$2
[[ $task =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ ]] || die "the task name is letters, digits, . _ - (got: $task)"
[[ -z $(git status --porcelain) ]] || die "the tree has changes. Commit or remove them first:
$(git status --short | head -n 8)"

git fetch -q origin 2>/dev/null || echo "worker-start: git fetch failed, using what is here" >&2
sha=$(git rev-parse --verify -q "$base^{commit}") || die "$base is not a commit here (fetched from origin?)"

# A brief line "After: U1 S1" names tasks whose work this one builds on or shares files with. Each needs a commit
# "U1: ..." in the base, else the task would redo or conflict with it (U2, U3 and U4 of 0.8.4 started before U1 landed
# and all three were merged or rebuilt by hand). Read from the base, where the lead wrote the brief.
brief_in_base=$(git ls-tree -r --name-only "$sha" -- .claude/plan 2>/dev/null | grep -m 1 -xE "\.claude/plan/[^/]+/${task//./\\.}\.md" || true)
after=''
if [[ -n $brief_in_base ]]; then
  after=$(git show "$sha:$brief_in_base" | sed -n '/^After:/{s/^After:[[:space:]]*//;s/[,[:space:]][,[:space:]]*/ /g;s/ $//;p;q;}') || true
  missing=()
  for dep in $after; do
    [[ $dep =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ ]] || die "the brief's After: line names \"$dep\", which is no task id"
    git log --format=%s "$sha" | awk -v p="$dep:" 'index($0, p) == 1 { f = 1 } END { exit !f }' || missing+=("$dep")
  done
  ((${#missing[@]} == 0)) || die "the brief says After: $after, and ${base:0:12} has no commit \"${missing[0]}: ...\" (missing: ${missing[*]}). Start from a base that has it: the lead lands it first or gives its branch tip."
fi

if [[ $(git rev-parse HEAD) == "$sha" ]]; then
  echo "on ${sha:0:12} already"
elif git merge-base --is-ancestor "$sha" HEAD; then
  echo "HEAD already contains ${sha:0:12}, kept"
elif git merge-base --is-ancestor HEAD "$sha"; then
  git merge -q --ff-only "$sha"
  echo "fast-forwarded to ${sha:0:12}"
else
  die "HEAD ($(git rev-parse --short HEAD)) and $base have diverged: a task starts from a branch that can fast-forward to its base"
fi
echo "$sha" >"$(git rev-parse --git-dir)/worker-base"

if [[ ! -d node_modules ]]; then
  echo "installing (frozen lockfile, offline)"
  pnpm install --frozen-lockfile --offline >/dev/null || die "pnpm install failed: the lockfile or the offline store does not match. Do not change the lockfile; tell the lead."
fi

scratch=${WORKER_SCRATCH:-/tmp/claude-0/work}/$task
mkdir -p "$scratch" && chmod 700 "$scratch"

brief=$(compgen -G ".claude/plan/*/$task.md" | head -n 1 || true)
echo "scratch: $scratch (private; keep probes and edit scripts here, not in the repo)"
echo "brief:   ${brief:-none found at .claude/plan/*/$task.md}"
[[ -z $after ]] || echo "after:   $after (in the base)"
if [[ -n $brief ]]; then
  owns=$(sed -n '/^Owns:/{s/^Owns:[[:space:]]*//;p;q;}' "$brief")
  [[ -z $owns ]] || echo "owns:    $owns (other files only as the brief's Shared: line says)"
fi
echo "check:   pnpm check --changed   (base ${sha:0:12}; plain pnpm check runs everything)"
