#!/usr/bin/env bash
# `git commit` for a machine whose commits are signed by a remote signing server that sometimes answers 503.
#   tools/commit.sh -m "message" [other git commit options]
# Retries only when the signing server answered 503 ("status 503" or "HTTP 503" in the error): after 5, 15 and 45 seconds
# (COMMIT_BACKOFF="5 15 45"; pattern COMMIT_RETRY_ON). Any other failure ends at once with git's own message.
# Never commits unsigned: it refuses --no-gpg-sign (and its abbreviations), commit.gpgsign=false in an argument and a setup where commit.gpgsign is off, and it checks the new commit
# carries a signature. It refuses to go on when the index changed between two tries, so a retry never commits more
# or less than the first try would have.
set -uo pipefail

die() { echo "commit.sh: $*" >&2; exit 2; }
# the signing server's answer ("status 503", "HTTP 503", "HTTP/1.1 503"), never a bare 503 in a hook's output
RETRY_ON=${COMMIT_RETRY_ON:-'(status|HTTP)[^0-9]{0,3}([0-9.]+ )?503'}
read -ra waits <<<"${COMMIT_BACKOFF:-5 15 45}"

signed_by_default=$(git config --type=bool --get commit.gpgsign 2>/dev/null || echo false)
wants_signature=$signed_by_default
once=0
for a in "$@"; do
  [[ ${a,,} =~ commit\.gpgsign=(false|0|no|off) ]] && die "refusing $a: commits here are signed"
  case $a in
    # the command takes any unambiguous start of a long option, so --no-gpg and --no-g are --no-gpg-sign too
    --no-g*) [[ --no-gpg-sign == "$a"* ]] && die "refusing $a: commits here are signed" ;;
    -S | --gpg-sign | --gpg-sign=*) wants_signature=true ;;
    --file=- | -) once=1 ;; # a message read from stdin cannot be read twice
  esac
done
[[ $wants_signature == true ]] || die "commit.gpgsign is off and no -S given: this would commit unsigned"
[[ $* != *"--dry-run"* ]] || exec git commit "$@"

index() { git write-tree 2>/dev/null || echo unreadable; }
before=$(git rev-parse -q --verify HEAD 2>/dev/null || echo none)
tree=$(index)
err=$(mktemp)
trap 'rm -f "$err"' EXIT

try=0
while :; do
  git commit "$@" 2>"$err"
  rc=$?
  if ((rc == 0)); then
    cat "$err" >&2
    after=$(git rev-parse -q --verify HEAD 2>/dev/null || echo none)
    if [[ $after != "$before" ]] && ! git cat-file commit "$after" | grep -q '^gpgsig'; then
      echo "commit.sh: the new commit ${after:0:10} has no signature. Do not push it; amend it with the signing server up." >&2
      exit 1
    fi
    exit 0
  fi
  if ((once)) || ! grep -Eiq "$RETRY_ON" "$err" || ((try >= ${#waits[@]})); then
    cat "$err" >&2
    ((try == 0)) || echo "commit.sh: gave up after $try retries" >&2
    exit "$rc"
  fi
  echo "commit.sh: the signing server answered 503, retry $((try + 1)) of ${#waits[@]} in ${waits[$try]} s" >&2
  sleep "${waits[$try]}"
  try=$((try + 1))
  [[ $(index) == "$tree" ]] || die "the index changed while waiting: look at it and commit again"
done
