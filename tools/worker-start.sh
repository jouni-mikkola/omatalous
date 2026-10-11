#!/usr/bin/env bash
# The first command of a worker task: puts the worktree on the base commit and prepares what the task needs.
#   tools/worker-start.sh <base> <task>
# Refuses a tree with changes. Fast-forwards HEAD to <base> (a sha or a ref; refuses when that is not a fast-forward),
# runs `pnpm install --frozen-lockfile --offline` when node_modules is missing, makes a private scratch folder
# $WORKER_SCRATCH/<task> (default /tmp/claude-0/work) and prints it with the brief. The base is also recorded, so
# `pnpm check --changed` knows what the diff is against.
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
echo "check:   pnpm check --changed   (base ${sha:0:12}; plain pnpm check runs everything)"
