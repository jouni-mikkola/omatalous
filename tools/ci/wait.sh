#!/usr/bin/env bash
# Waits for named checks of a commit on GitHub: tools/ci/wait.sh [--repo OWNER/NAME] [--timeout S] [--interval S] <sha> <check>...
#   tools/ci/wait.sh "$(git rev-parse HEAD)" ci-ok upgrade-ok
# Polls the check runs of the commit (gh api) until every named check has completed.
#   exit 0  every named check succeeded
#   exit 1  a named check failed or was skipped: its name, result and address are printed at once
#   exit 3  a named check was cancelled and none failed: "CANCELLED <check> (superseded by a newer push?)". Push again
#           or wait for the newer commit.
#   exit 2  CI cannot be read (no gh or jq, gh not signed in, the commit is not on GitHub, the network) or the timeout
#           ran out first. The message says which. Read CI another way then, for example with the GitHub tools.
# A check that has not appeared yet is pending, never green. When several runs carry one name (a rerun, one commit on two
# branches) the newest decides. The repository is origin's; --repo or WAIT_REPO names another. WAIT_TIMEOUT (default
# 1500) and WAIT_INTERVAL (default 15) are seconds. Run it in the background: it prints one line at the end.
set -uo pipefail

say() { printf 'wait: %s\n' "$*"; }
cannot() { printf 'wait: cannot read CI: %s\n' "$*" >&2; exit 2; }
usage() { printf 'Usage: wait.sh [--repo OWNER/NAME] [--timeout S] [--interval S] <sha> <check>...\n' >&2; exit 2; }

repo=${WAIT_REPO:-}
timeout=${WAIT_TIMEOUT:-1500}
interval=${WAIT_INTERVAL:-15}
sha=
checks=()
while (($#)); do
  case $1 in
    --repo) (($# >= 2)) || usage; repo=$2; shift ;;
    --timeout) (($# >= 2)) || usage; timeout=$2; shift ;;
    --interval) (($# >= 2)) || usage; interval=$2; shift ;;
    -h | --help) sed -n '2,/^[^#]/{/^#/p}' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    -*) usage ;;
    *) if [[ -z $sha ]]; then sha=$1; else checks+=("$1"); fi ;;
  esac
  shift
done
[[ $sha =~ ^[0-9a-f]{7,40}$ ]] && ((${#checks[@]})) || usage
[[ $timeout =~ ^[0-9]+$ && $interval =~ ^[0-9]+$ ]] || usage

command -v gh >/dev/null 2>&1 || cannot "gh is not installed."
command -v jq >/dev/null 2>&1 || cannot "jq is not installed."
if [[ -z $repo ]]; then
  url=$(git remote get-url origin 2>/dev/null || true)
  repo=$(sed -nE 's#^.*github\.com[:/]([^/]+/[^/]+)$#\1#p' <<<"${url%.git}")
  [[ -n $repo ]] || cannot "origin is not a GitHub repository ($url). Pass --repo OWNER/NAME."
fi

names=$(printf '%s\n' "${checks[@]}" | jq -R . | jq -s .)
say "waiting for ${checks[*]} on ${sha:0:7} in $repo"

failures=0
while :; do
  if ! answer=$(gh api --paginate "repos/$repo/commits/$sha/check-runs?per_page=100" 2>&1); then
    shopt -s nocasematch
    if [[ $answer == *"bad credentials"* || $answer == *"401"* || $answer == *"gh auth login"* || $answer == *"authentication"* || $answer == *"GH_TOKEN"* ]]; then
      cannot "gh is not signed in (${answer%%$'\n'*})."
    elif [[ $answer == *"not found"* || $answer == *"404"* || $answer == *"No commit found"* || $answer == *"422"* ]]; then
      cannot "GitHub has no commit ${sha:0:7} in $repo (${answer%%$'\n'*}). Push it first, or check --repo."
    fi
    shopt -u nocasematch
    failures=$((failures + 1))
    ((failures < 3)) || cannot "gh failed three times in a row: ${answer%%$'\n'*}"
  else
    failures=0
    # one row per named check: name, status, conclusion, address of the newest run with that name
    rows=$(jq -rs --argjson names "$names" '
      [.[].check_runs[]?] as $runs
      | $names[] as $n
      | ([$runs[] | select(.name == $n)] | sort_by(.id) | last) as $r
      | [$n, ($r.status // "missing"), ($r.conclusion // ""), ($r.html_url // "")] | @tsv' <<<"$answer") || cannot "GitHub's answer was not readable."
    pending=() bad=() good=() cancelled=()
    while IFS=$'\t' read -r name status conclusion link; do
      if [[ $status != completed ]]; then pending+=("$name($status)")
      elif [[ $conclusion == success ]]; then good+=("$name")
      elif [[ $conclusion == cancelled ]]; then cancelled+=("$name $link")
      else bad+=("$name: $conclusion $link"); fi
    done <<<"$rows"
    if ((${#bad[@]} || ${#cancelled[@]})); then
      for b in "${bad[@]}"; do say "FAILED $b"; done
      for b in "${cancelled[@]}"; do say "CANCELLED $b (superseded by a newer push?)"; done
      ((${#pending[@]})) && say "not finished: ${pending[*]}"
      # a failure wins over a cancellation: that run did not end because of a newer push
      ((${#bad[@]})) && exit 1
      exit 3
    fi
    if ((${#pending[@]} == 0)); then
      say "ok ${good[*]} on ${sha:0:7} after ${SECONDS}s"
      exit 0
    fi
  fi
  if ((SECONDS >= timeout)); then
    printf 'wait: timed out after %ss, still waiting for: %s\n' "$timeout" "${pending[*]:-the answer of GitHub}" >&2
    exit 2
  fi
  sleep "$interval"
done
