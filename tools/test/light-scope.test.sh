#!/usr/bin/env bash
# Tests for tools/ci/light-scope.sh in a small repository: the line a pull request, a push, a new branch and a hand
# start get for tools/check.sh (never a run of the page tests, the image or the build).
#
#   tools/test/light-scope.test.sh
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
REPO=$(cd "$HERE/../.." && pwd)
PASS=0; FAILED=0
pass() { PASS=$((PASS + 1)); echo "ok   $1"; }
fail() { FAILED=$((FAILED + 1)); echo "FAIL $1"; [[ -z ${2:-} ]] || echo "       $2"; }
is() { if [[ $2 == "$3" ]]; then pass "$1"; else fail "$1" "got: $2"; fi; }

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
W=$TMP/w
git init -q "$W"
cd "$W" || exit 1
git config user.email t@t; git config user.name t; git config commit.gpgsign false
echo a >f; git add f; git commit -q -m one
FIRST=$(git rev-parse HEAD)
echo b >f; git commit -q -am two
git update-ref refs/remotes/origin/main "$FIRST"
scope() { env -u EVENT -u BASE_REF -u BEFORE "$@" bash "$REPO/tools/ci/light-scope.sh"; }

is "a pull request is checked against its base branch" "$(scope EVENT=pull_request BASE_REF=main)" "args=--changed origin/main"
is "a push is checked against the commit it replaced" "$(scope EVENT=push BEFORE="$FIRST")" "args=--changed $FIRST"
is "a new branch (all-zero before) is checked against main" "$(scope EVENT=push BEFORE=0000000000000000000000000000000000000000)" "args=--changed origin/main"
is "a before the clone does not hold runs everything" "$(scope EVENT=push BEFORE=1111111111111111111111111111111111111111)" "args="
is "a base branch the clone does not know runs everything" "$(scope EVENT=pull_request BASE_REF=gone)" "args="
is "a run started by hand is checked against main" "$(scope EVENT=workflow_dispatch)" "args=--changed origin/main"
git update-ref -d refs/remotes/origin/main
is "a hand start with no main in the clone runs every lint, type check and test of the tier" "$(scope EVENT=workflow_dispatch)" "args="
git update-ref refs/remotes/origin/main "$FIRST"
is "an empty base_ref on a pull request runs everything" "$(scope EVENT=pull_request BASE_REF=)" "args="

echo
echo "$PASS passed, $FAILED failed"
[[ $FAILED -eq 0 ]]
