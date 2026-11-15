#!/usr/bin/env bash
# Visual regression check: pictures of the same routes on a base commit and on the working tree, compared pixel by pixel.
#   tools/visual-check.sh <base-ref> [--threshold share] -- <pnpm shots arguments>
# Takes the base's pictures in a throwaway worktree (installed offline from the store, built by pnpm shots), the
# working tree's in this clone, both with SHOTS_STILL=1, then runs tools/shots-diff.mjs. Exit 1 when a picture changed
# over the threshold (default 0.2 % of its pixels), 2 when a step could not run. The pictures and the diff pictures stay
# in $TMPDIR/visual/<base>-<time>/ (/tmp/visual when TMPDIR is not set) and the last line names it.
set -euo pipefail

usage() { echo "usage: tools/visual-check.sh <base-ref> [--threshold share] -- <pnpm shots arguments>" >&2; exit 2; }
[ $# -ge 1 ] || usage
base=$1
shift
diff_args=()
while [ $# -gt 0 ] && [ "$1" != "--" ]; do
  case $1 in
    --threshold) [ $# -ge 2 ] || usage; diff_args+=(--threshold "$2"); shift 2 ;;
    *) usage ;;
  esac
done
[ "${1:-}" = "--" ] || usage
shift
[ $# -ge 1 ] || usage

root=$(git rev-parse --show-toplevel)
commit=$(git -C "$root" rev-parse --verify --quiet "$base^{commit}") || { echo "visual-check: no commit $base" >&2; exit 2; }
work=${TMPDIR:-/tmp}/visual/$(git -C "$root" rev-parse --short "$commit")-$(date +%s)
mkdir -p "$work"
tree="$work/base"
# shellcheck disable=SC2317 # run by the EXIT trap
cleanup() { git -C "$root" worktree remove --force "$tree" >/dev/null 2>&1 || true; }
trap cleanup EXIT

git -C "$root" worktree add --detach "$tree" "$commit" >/dev/null 2>&1 || { echo "visual-check: could not check out $base" >&2; exit 2; }
(cd "$tree" && pnpm install --offline --frozen-lockfile >"$work/install.log" 2>&1) || { echo "visual-check: install of $base failed ($work/install.log)" >&2; exit 2; }
echo "visual-check: pictures of $base"
(cd "$tree" && SHOTS_STILL=1 SHOTS_DIR="$work/before" pnpm -s shots "$@") >"$work/before.log" 2>&1 || { echo "visual-check: pnpm shots failed on $base ($work/before.log)" >&2; exit 2; }
echo "visual-check: pictures of the working tree"
(cd "$root" && SHOTS_STILL=1 SHOTS_DIR="$work/after" pnpm -s shots "$@") >"$work/after.log" 2>&1 || { echo "visual-check: pnpm shots failed on the working tree ($work/after.log)" >&2; exit 2; }
status=0
node "$root/tools/shots-diff.mjs" "$work/before" "$work/after" --out "$work/diff" "${diff_args[@]}" || status=$?
echo "visual-check: $work"
exit "$status"
