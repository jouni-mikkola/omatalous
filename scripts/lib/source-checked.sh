# The source channel that takes only what GitHub checked. Sourced by lib/release.sh, after PROJECT_OWNER and PROJECT_REPO,
# so it is there wherever release.sh is: update.sh, install.sh and the maintenance helper with the launcher's last good
# copy of scripts/lib. A release.sh copied alone (the release signature check) goes without it and needs none of it.
# checked_source_target, at the end, is the helper's: it calls fail and say_log of scripts/ops-helper.sh.
# shellcheck shell=bash

# With TALOUS_SOURCE_CHECKED=yes in .env a source install takes a commit of its branch only after the runs GitHub started
# for the push of that commit have passed: the workflow `check` (ci.yml) and the workflow `privacy`. One call lists the
# newest push runs of the branch (a public repository needs no key for it), and the newest commit that passed between
# this folder and the branch is the one to install. A commit whose run failed, was cancelled or has not ended is never
# it. The address is fixed here, as for the releases.
#
# `check` starts no run for a push that changes documents alone (paths-ignore in ci.yml; CHECK_SKIPS is a copy that
# tools/test/source-checked.test.ts holds to the file). Such a commit runs the code of the commit before it, so it
# counts as checked when that one does. `privacy` runs for every push and is asked of the commit itself.
RUNS_API=https://api.github.com/repos/$PROJECT_OWNER/$PROJECT_REPO/actions/runs
CHECK_WORKFLOW=.github/workflows/ci.yml
PRIVACY_WORKFLOW=.github/workflows/privacy.yml
CHECK_SKIPS=('**.md' 'docs/**' 'relay/**' LICENSE)
source_checked() { # whether .env asks for it (read as data); fails with 2 on a value that is not yes or no
  case $(grep -E '^TALOUS_SOURCE_CHECKED=' .env 2>/dev/null | tail -1 | cut -d= -f2- || true) in
    yes) return 0 ;;
    no | '') return 1 ;;
    *) return 2 ;;
  esac
}
runs_get() { # runs_get BRANCH FILE: asks for the 50 newest push runs of BRANCH, the answer goes to FILE, prints the HTTP code
  local code cap=()
  [[ -z ${T_CHECK:-} ]] || cap=(timeout -k 5 "$T_CHECK")
  code=$(${cap[@]+"${cap[@]}"} curl -sS -o "$2" -w '%{http_code}' --max-time 30 --max-filesize 4000000 --proto '=https' --tlsv1.2 \
    -H 'Accept: application/vnd.github+json' -H 'X-GitHub-Api-Version: 2022-11-28' -A "talous-ops/${OPS_HELPER_VERSION:-update.sh}" \
    "$RUNS_API?branch=$1&event=push&per_page=50" 2>/dev/null) || code=000
  printf '%s' "$code"
}
# runs_rows BRANCH FILE: one line "commit workflow-file verdict" for each push run of BRANCH in the answer, newest first as
# GitHub lists them. The verdict is pass (completed with success), fail (completed with anything else) or wait. Only the
# keys of a run itself count, not those of its commit or its repository. Fails when the answer is no list of runs.
runs_rows() {
  grep -oE '"([^"\\]|\\.)*"|[][{}:,]|[^][{}:,"[:space:]]+' "$2" | awk -v branch="\"$1\"" '
    function row() {
      gsub(/^"|"$/, "", sha); gsub(/^"|"$/, "", path)
      if (length(sha) != 40 || sha !~ /^[0-9a-f]+$/ || path !~ /^\.github\/workflows\/[A-Za-z0-9._-]+$/ || event != "\"push\"" || head != branch) return
      verdict = "wait"
      if (status == "\"completed\"") verdict = (conclusion == "\"success\"") ? "pass" : "fail"
      printf "%s %s %s\n", sha, path, verdict
    }
    $0 == ":" { key = prev; ev = 1; next }
    $0 == "," { ev = 0; next }
    $0 == "{" || $0 == "[" {
      d++
      if ($0 == "[" && d == 2 && key == "\"workflow_runs\"") { list = 1; seen = 1 }
      if ($0 == "{" && d == 3 && list) sha = path = status = conclusion = event = head = ""
      ev = 0; next
    }
    $0 == "}" || $0 == "]" {
      if ($0 == "}" && d == 3 && list) row()
      if ($0 == "]" && d == 2) list = 0
      d--; ev = 0; next
    }
    ev {
      if (d == 3 && list) {
        if (key == "\"head_sha\"") sha = $0; else if (key == "\"path\"") path = $0; else if (key == "\"status\"") status = $0
        else if (key == "\"conclusion\"") conclusion = $0; else if (key == "\"event\"") event = $0; else if (key == "\"head_branch\"") head = $0
      }
      ev = 0; next
    }
    { prev = $0 }
    END { if (!seen || d != 0) exit 1 }'
}
run_verdict() { # run_verdict ROWS COMMIT WORKFLOW: the verdict of the newest run of WORKFLOW for COMMIT; fails when it has none
  awk -v c="$2" -v w="$3" '$1 == c && $2 == w { print $3; found = 1; exit } END { exit !found }' "$1"
}
skips_check() { # skips_check COMMIT: every file the commit changes is one that starts no run of `check` (CHECK_SKIPS)
  local f p hit n=0
  git rev-parse -q --verify "$1^^{commit}" >/dev/null 2>&1 || return 1
  while IFS= read -r -d '' f; do
    n=$((n + 1)); hit=''
    for p in "${CHECK_SKIPS[@]}"; do
      case $p in
        '**'*) [[ $f != *"${p#'**'}" ]] || hit=1 ;;
        *'/**') [[ $f != "${p%'**'}"* ]] || hit=1 ;;
        *) [[ $f != "$p" ]] || hit=1 ;;
      esac
    done
    [[ -n $hit ]] || return 1
  done < <(git diff --name-only --no-renames -z "$1^" "$1" 2>/dev/null)
  ((n > 0))
}
# commit_checked ROWS COMMIT: both workflows passed for COMMIT. When not, CHECKED_WHY says which one stands in the way.
commit_checked() {
  local rows=$1 at=$2 v n=0
  v=$(run_verdict "$rows" "$2" "$PRIVACY_WORKFLOW") || v=none
  case $v in
    pass) ;;
    fail) CHECKED_WHY="privacy failed"; return 1 ;;
    wait) CHECKED_WHY="privacy has not ended"; return 1 ;;
    *) CHECKED_WHY="no run of privacy is listed"; return 1 ;;
  esac
  # the commit `check` ran for: this one, or the one before a row of commits that change documents alone
  until v=$(run_verdict "$rows" "$at" "$CHECK_WORKFLOW"); do
    n=$((n + 1)); CHECKED_WHY="no run of check is listed"
    ((n <= 50)) && skips_check "$at" || return 1
    at=$(git rev-parse -q --verify "$at^^{commit}") || return 1
  done
  case $v in
    pass) return 0 ;;
    fail) CHECKED_WHY="check failed" ;;
    *) CHECKED_WHY="check has not ended" ;;
  esac
  return 1
}
# checked_pick ROWS FROM TO: the newest commit after FROM, up to TO, that passed. It prints two lines: the commit, and
# what TO waits for when the commit is an older one (else an empty line). When none passed it prints the one line of
# what TO waits for, and fails.
checked_pick() {
  local c why='' tip=true CHECKED_WHY=''
  while IFS= read -r c; do
    if commit_checked "$1" "$c"; then printf '%s\n%s\n' "$c" "$why"; return 0; fi
    [[ $tip != true ]] || why=$CHECKED_WHY
    tip=false
  done < <(git rev-list --first-parent "$2..$3" 2>/dev/null)
  printf '%s\n' "${why:-nothing new}"
  return 1
}
# checked_answer FROM TO BRANCH: asks GitHub once, then prints what checked_pick prints. Fails with 1 when GitHub gave no
# usable answer, with 2 when no commit after FROM has passed and with 3 when GitHub turned the request down with 403 or
# 429 (the limit of requests for this address, 60 an hour without a key).
checked_answer() {
  local f rc=0
  [[ $3 =~ ^[A-Za-z0-9][A-Za-z0-9._/-]{0,99}$ && $3 != *..* ]] || return 1
  f=$(mktemp) || return 1
  case $(runs_get "$3" "$f") in
    200) runs_rows "$3" "$f" >"$f.rows" || rc=1 ;;
    403 | 429) rc=3 ;;
    *) rc=1 ;;
  esac
  ((rc != 0)) || checked_pick "$f.rows" "$1" "$2" || rc=2
  rm -f "$f" "$f.rows"
  return "$rc"
}
# checked_source_target BRANCH: the maintenance helper's update on the source channel (act_update). With
# TALOUS_SOURCE_CHECKED=yes the caller's target, the tip of BRANCH, becomes the newest commit up to it whose checks passed
# on GitHub, asked once. When none has passed or GitHub gave no answer, it calls fail and fails. Without the key it does nothing.
checked_source_target() {
  source_checked || return 0
  local picked rc=0
  picked=$(checked_answer HEAD "$target" "$1") || rc=$?
  if ((rc == 2)); then say_log "The newest source is not taken yet: $(head -n 1 <<<"$picked") on GitHub."; fail "Uusimman version tarkistukset GitHubissa eivät ole vielä menneet läpi. Mikään ei muuttunut."; return 1; fi
  if ((rc != 0)); then fail "Uusimman version tarkistuksia ei voitu kysyä GitHubista. Mikään ei muuttunut."; return 1; fi
  target=$(head -n 1 <<<"$picked")
  [[ $target =~ ^[0-9a-f]{40}$ ]] || { fail "Lähdekoodin uusinta versiota ei löytynyt."; return 1; }
  say_log "GitHub's checks passed for ${target:0:8}."
  return 0
}
