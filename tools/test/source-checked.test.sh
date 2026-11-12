#!/usr/bin/env bash
# Tests for a source install that waits for GitHub's checks (TALOUS_SOURCE_CHECKED=yes, scripts/lib/release.sh): which
# commit update.sh run by hand and the helper's Päivitä button take, from the runs GitHub lists. Against the stub world of
# tools/test/ops-world.sh with a curl that plays the list of runs from a file: nothing here touches GitHub, a real
# container or a real registry.
#
#   tools/test/source-checked.test.sh [name-filter]
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
# shellcheck disable=SC2034 # ops-world.sh copies the scripts from there
SRC=${OPS_TEST_SRC:-$(cd "$HERE/../.." && pwd)}
FILTER=${1:-}
want() { [[ -z $FILTER || $1 == *$FILTER* ]]; }
# shellcheck source=ops-world.sh
. "$HERE/ops-world.sh"
unprivileged source-checked.test.sh "$@"

RUNS='https://api.github.com/repos/jouni-mikkola/omatalous/actions/runs?branch=main&event=push&per_page=50'
CI=.github/workflows/ci.yml
PRIV=.github/workflows/privacy.yml
# The world's curl answers only /releases/latest. This one answers only the list of runs, from runs.json and runs.status.
world() {
  new_world
  cat >"$S/bin/curl" <<'EOF'
#!/usr/bin/env bash
S=$OPS_STUB_DIR; out=""; url=""
while (($#)); do case $1 in -o) out=$2; shift ;; http*) url=$1 ;; esac; shift; done
printf 'curl %s\n' "$url" >>"$S/calls.log"
[[ $url == 'https://api.github.com/repos/jouni-mikkola/omatalous/actions/runs?branch=main&event=push&per_page=50' ]] || { printf 000; exit 1; }
code=$(cat "$S/runs.status" 2>/dev/null || echo 200)
[[ $code != 200 ]] || cp "$S/runs.json" "$out"
printf '%s' "$code"
EOF
  chmod +x "$S/bin/curl"
  setenv TALOUS_CHANNEL=source TALOUS_SOURCE_CHECKED=yes
  runs
}
# One run as the API prints it. Its commit, repository and actor carry keys with the names of the run's own (a status, a
# conclusion, a path, a head_sha), which are not the run's.
run() { # run COMMIT WORKFLOW-FILE STATUS CONCLUSION [EVENT] [BRANCH]
  local concl=null
  [[ $4 == null ]] || concl="\"$4\""
  printf '    {\n      "id": 1,\n      "name": "x",\n      "head_branch": "%s",\n      "head_sha": "%s",\n      "path": "%s",\n      "event": "%s",\n      "status": "%s",\n      "conclusion": %s,\n      "pull_requests": [],\n      "actor": {\n        "login": "someone",\n        "status": "completed",\n        "conclusion": "success"\n      },\n      "head_commit": {\n        "id": "%s",\n        "message": "a \\"quoted\\" {brace} [x]: text",\n        "path": "%s",\n        "author": { "name": "n", "status": "completed" }\n      },\n      "repository": {\n        "head_sha": "0000000000000000000000000000000000000000",\n        "conclusion": "success"\n      }\n    }' \
    "${6:-main}" "$1" "$2" "${5:-push}" "$3" "$concl" "$1" "$CI"
}
runs() { # runs RUN...: the answer to the list, in this order (GitHub lists the newest first)
  local r sep=""
  printf '{\n  "total_count": %s,\n  "workflow_runs": [\n' "$#" >"$S/runs.json"
  for r in "$@"; do printf '%s%s' "$sep" "$r" >>"$S/runs.json"; sep=$',\n'; done
  printf '\n  ]\n}\n' >>"$S/runs.json"
}
passed() { run "$1" "$CI" completed success; printf ',\n'; run "$1" "$PRIV" completed success; } # both workflows passed for COMMIT
seed_head() { git -C "$W/seed" rev-parse HEAD; }
doc_commit() { # a commit on main that changes documents alone, which starts no run of `check`
  mkdir -p "$W/seed/docs/sub"; echo "d$RANDOM" >>"$W/seed/docs/sub/page.txt"; echo "r$RANDOM" >>"$W/seed/README.md"; echo "l$RANDOM" >>"$W/seed/LICENSE"
  git -C "$W/seed" add -A; git -C "$W/seed" commit -qm "docs $RANDOM"; git -C "$W/seed" push -q origin main 2>/dev/null
}
by_hand() {
  : >"$S/calls.log"
  OUT=$(cd "$CL" && env OPS_STUB_DIR="$S" HOME="$W/home" PATH="$S/bin:/usr/local/bin:/usr/bin:/bin" "$@" ./scripts/update.sh --yes </dev/null 2>&1); RC=$?
}
curls() { calls | grep '^curl ' || true; }
untouched() { test "$(n_calls '^docker (pull|image tag|compose (up|build))')" = 0; }
at() { test "$(head_commit)" = "$1"; }
says() { [[ $OUT == *"$1"* ]]; }

# ── update.sh by hand ───────────────────────────────────────────────────────
t_passed_tip_is_taken() {
  local tip
  world; src_commit; src_commit; tip=$(seed_head)
  runs "$(passed "$tip")"; by_hand
  check "passed: the newest commit is built and the folder is at it" test "$RC" = 0 -a "$(n_calls '^docker compose build')" = 1 -a "$(head_commit)" = "$tip"
  check "passed: one call, to the list of push runs of the branch" test "$(curls)" = "curl $RUNS"
  check "passed: and it says so" says "GitHub's checks passed for $(git -C "$CL" rev-parse --short "$tip")"
  by_hand
  check "passed, run again: already current, and GitHub is not asked" bash -c "[[ $RC == 0 && \$1 == *'Already current'* && -z \$2 ]]" x "$OUT" "$(curls)"
}
t_key_off_asks_nothing() {
  local key
  for key in "" TALOUS_SOURCE_CHECKED=no; do
    world; setenv TALOUS_CHANNEL=source $key; src_commit; by_hand
    check "key off (${key:-no key}): the newest source is built as before" test "$RC" = 0 -a "$(head_commit)" = "$(seed_head)"
    check "key off (${key:-no key}): GitHub is not asked" test "$(curls)" = ""
  done
}
t_waiting_tip_changes_nothing() {
  local tip before st
  for st in queued in_progress waiting requested pending; do
    world; before=$(head_commit); src_commit; tip=$(seed_head)
    runs "$(run "$tip" "$CI" "$st" null)" "$(run "$tip" "$PRIV" completed success)"; by_hand
    check "waiting ($st): update.sh ends well and nothing is built or started" eval "[[ $RC == 0 ]] && untouched"
    check "waiting ($st): the folder is where it was" at "$before"
    check "waiting ($st): it says what the commit waits for" says "is not taken yet: check has not ended on GitHub. Nothing newer is installed."
  done
  world; before=$(head_commit); src_commit; tip=$(seed_head)
  runs "$(run "$tip" "$CI" completed success)" "$(run "$tip" "$PRIV" in_progress null)"; by_hand
  check "waiting: privacy still running holds the commit too" bash -c "[[ $RC == 0 && \$1 == *'privacy has not ended'* ]]" x "$OUT"
  check "waiting: privacy still running, the folder stays" at "$before"
  # then the run ends well and the same command takes the commit
  runs "$(passed "$tip")"; by_hand
  check "waiting, then passed: the commit is taken" at "$tip"
}
t_failed_tip_is_never_taken() {
  local tip before c
  for c in failure cancelled timed_out skipped action_required neutral stale startup_failure; do
    world; before=$(head_commit); src_commit; tip=$(seed_head)
    runs "$(run "$tip" "$CI" completed "$c")" "$(run "$tip" "$PRIV" completed success)"; by_hand
    check "failed ($c): check did not pass, the folder stays" bash -c "[[ $RC == 0 && \$1 == *'check failed on GitHub'* && \$2 == $before ]]" x "$OUT" "$(head_commit)"
    check "failed ($c): nothing built" untouched
  done
  world; before=$(head_commit); src_commit; tip=$(seed_head)
  runs "$(run "$tip" "$CI" completed success)" "$(run "$tip" "$PRIV" completed failure)"; by_hand
  check "failed: privacy did not pass, the folder stays" bash -c "[[ $RC == 0 && \$1 == *'privacy failed on GitHub'* && \$2 == $before ]]" x "$OUT" "$(head_commit)"
  # a later run of the same workflow for the commit (a run started again) is the one that counts: the list has the newest first
  runs "$(run "$tip" "$PRIV" completed success)" "$(run "$tip" "$CI" completed success)" "$(run "$tip" "$PRIV" completed failure)"; by_hand
  check "failed, then a newer run passed: the commit is taken" at "$tip"
  world; before=$(head_commit); src_commit; tip=$(seed_head)
  runs "$(run "$tip" "$PRIV" completed failure)" "$(run "$tip" "$CI" completed success)" "$(run "$tip" "$PRIV" completed success)"; by_hand
  check "passed, then a newer run failed: the commit is not taken" at "$before"
}
t_older_passed_commit_is_taken() {
  local good tip before
  world; before=$(head_commit); src_commit; src_commit; good=$(seed_head); src_commit; src_commit; tip=$(seed_head)
  runs "$(run "$tip" "$CI" in_progress null)" "$(run "$tip" "$PRIV" completed success)" \
    "$(run "$(git -C "$W/seed" rev-parse HEAD~1)" "$CI" completed failure)" "$(run "$(git -C "$W/seed" rev-parse HEAD~1)" "$PRIV" completed success)" \
    "$(passed "$good")" "$(passed "$(git -C "$W/seed" rev-parse HEAD~3)")"
  by_hand
  check "older: the newest commit that passed is installed, not the tip and not an older one" test "$RC" = 0 -a "$(head_commit)" = "$good"
  check "older: it is built once" test "$(n_calls '^docker compose build')" = 1
  check "older: it says what the tip waits for and what it took" says "is not taken yet: check has not ended on GitHub. Taking $(git -C "$CL" rev-parse --short "$good"), which passed."
  check "older: one call" test "$(curls)" = "curl $RUNS"
  test "$before" != "$good" || fail "older: the world did not move"
}
t_unlisted_commit_is_not_taken() {
  local before tip
  world; before=$(head_commit); src_commit; tip=$(seed_head)
  by_hand
  check "unlisted: an empty list holds the commit" bash -c "[[ $RC == 0 && \$1 == *'no run of privacy is listed'* && \$2 == $before ]]" x "$OUT" "$(head_commit)"
  # privacy passed, and a commit that changes code has no run of check yet: GitHub has not made it, or never will
  runs "$(run "$tip" "$PRIV" completed success)"; by_hand
  check "unlisted: a code commit with no run of check is held" bash -c "[[ $RC == 0 && \$1 == *'no run of check is listed'* && \$2 == $before ]]" x "$OUT" "$(head_commit)"
  # runs that are not the push run of this branch for this commit do not count
  runs "$(run "$tip" "$PRIV" completed success)" "$(run "$tip" "$CI" completed success pull_request)" "$(run "$tip" "$CI" completed success workflow_dispatch)" \
    "$(run "$tip" "$CI" completed success push other)" "$(run "$tip" .github/workflows/release.yml completed success)" "$(run "$before" "$CI" completed success)"
  by_hand
  check "unlisted: a run of another event, branch, workflow or commit is no run of check" at "$before"
  check "unlisted: nothing built" untouched
}
t_documents_alone_follow_the_commit_before() {
  local code tip before
  # two commits of documents on a code commit that passed: check never runs for them, privacy does
  world; before=$(head_commit); src_commit; code=$(seed_head); doc_commit; doc_commit; tip=$(seed_head)
  runs "$(run "$tip" "$PRIV" completed success)" "$(passed "$code")"; by_hand
  check "documents: the tip is taken on the check of the code commit below it" test "$RC" = 0 -a "$(head_commit)" = "$tip"
  # the same on a code commit whose check failed, or still runs
  world; before=$(head_commit); src_commit; code=$(seed_head); doc_commit; tip=$(seed_head)
  runs "$(run "$tip" "$PRIV" completed success)" "$(run "$code" "$CI" completed failure)" "$(run "$code" "$PRIV" completed success)"; by_hand
  check "documents: on a code commit whose check failed, nothing is taken" bash -c "[[ $RC == 0 && \$1 == *'check failed on GitHub'* && \$2 == $before ]]" x "$OUT" "$(head_commit)"
  runs "$(run "$tip" "$PRIV" completed success)" "$(run "$code" "$CI" in_progress null)" "$(run "$code" "$PRIV" completed success)"; by_hand
  check "documents: on a code commit whose check still runs, nothing is taken" at "$before"
  # the documents' own privacy run is asked of the commit itself
  runs "$(run "$tip" "$PRIV" completed failure)" "$(passed "$code")"; by_hand
  check "documents: a tip whose privacy failed is not taken, the code commit below is" at "$code"
  # a document beside a code file is a code commit
  world; before=$(head_commit); src_commit; code=$(seed_head)
  echo x >>"$W/seed/README.md"; echo y >>"$W/seed/CHANGES"; git -C "$W/seed" add -A; git -C "$W/seed" commit -qm mixed; git -C "$W/seed" push -q origin main 2>/dev/null; tip=$(seed_head)
  runs "$(run "$tip" "$PRIV" completed success)" "$(passed "$code")"; by_hand
  check "documents: a commit that also changes code needs its own run of check" at "$code"
  # names that only look like documents
  world; before=$(head_commit)
  mkdir -p "$W/seed/apps/docs" "$W/seed/sub"; echo x >"$W/seed/apps/docs/a.ts"; echo x >"$W/seed/sub/LICENSE"; echo x >"$W/seed/notes.mdx"
  git -C "$W/seed" add -A; git -C "$W/seed" commit -qm lookalikes; git -C "$W/seed" push -q origin main 2>/dev/null; tip=$(seed_head)
  runs "$(run "$tip" "$PRIV" completed success)" "$(passed "$before")"; by_hand
  check "documents: docs/ deeper in the tree, a LICENSE in a folder and .mdx are code" at "$before"
  # a document moved out of docs/ to a code path changes a code path
  world; doc_commit; src_commit; before=$(seed_head); git -C "$CL" pull -q --ff-only 2>/dev/null
  git -C "$W/seed" mv docs/sub/page.txt page.sh; git -C "$W/seed" commit -qm move; git -C "$W/seed" push -q origin main 2>/dev/null; tip=$(seed_head)
  runs "$(run "$tip" "$PRIV" completed success)" "$(passed "$before")"; by_hand
  check "documents: a file moved out of docs/ is a code change" at "$before"
}
t_no_answer_changes_nothing() {
  local before code
  for code in 000 500 404 301; do
    world; before=$(head_commit); src_commit; runs "$(passed "$(seed_head)")"; echo "$code" >"$S/runs.status"; by_hand
    check "no answer ($code): update.sh stops and says so" bash -c "[[ $RC != 0 && \$1 == *'Could not ask GitHub whether the checks of the newest source passed. Nothing was changed.'* ]]" x "$OUT"
    check "no answer ($code): nothing built, the folder stays" bash -c "[[ \$1 == $before ]]" x "$(head_commit)"
    check "no answer ($code): nothing touched" untouched
  done
  for code in 403 429; do
    world; before=$(head_commit); src_commit; echo "$code" >"$S/runs.status"; by_hand
    check "limit ($code): update.sh names the limit of requests" bash -c "[[ $RC != 0 && \$1 == *'the limit of requests for this address was met'* && \$2 == $before ]]" x "$OUT" "$(head_commit)"
  done
  # 200 with something that is no list of runs
  world; before=$(head_commit); src_commit
  for body in '{"message": "Not Found"}' '[]' '' '{"total_count": 1, "workflow_runs": [ {"head_sha": "x"' '{"workflow_runs": {"head_sha": "x"}}'; do
    printf '%s\n' "$body" >"$S/runs.json"; by_hand
    check "no list (${body:0:24}): no answer, nothing changed" bash -c "[[ $RC != 0 && \$1 == *'Could not ask GitHub'* && \$2 == $before ]]" x "$OUT" "$(head_commit)"
  done
}
t_bad_key_value_refused() {
  local v before
  for v in true 1 YES "yes " maybe; do
    world; before=$(head_commit); src_commit; runs "$(passed "$(seed_head)")"; setenv TALOUS_CHANNEL=source "TALOUS_SOURCE_CHECKED=$v"; by_hand
    check "bad key '$v': update.sh refuses and builds nothing" bash -c "[[ $RC != 0 && \$1 == *'TALOUS_SOURCE_CHECKED in .env is invalid. Allowed: yes, no. Nothing was changed.'* && \$2 == $before ]]" x "$OUT" "$(head_commit)"
    poll update; tick
    check "bad key '$v': the helper does not run, and says why" bash -c "[[ $TICK_RC == 1 ]] && grep -q '\.env is invalid: TALOUS_SOURCE_CHECKED is invalid' '$W/tick.out'"
    check "bad key '$v': the folder stays" at "$before"
  done
}
t_release_channel_does_not_ask() {
  world; release 0.2.0; setenv TALOUS_SOURCE_CHECKED=yes
  printf '{\n  "tag_name": "v0.2.0",\n  "body": "n"\n}\n' >"$S/release.json"
  # the world's own curl, for the release: the key must make no call for the runs on the release channel
  cat >"$S/bin/curl" <<'EOF'
#!/usr/bin/env bash
S=$OPS_STUB_DIR; out=""; url=""
while (($#)); do case $1 in -o) out=$2; shift ;; http*) url=$1 ;; esac; shift; done
printf 'curl %s\n' "$url" >>"$S/calls.log"
[[ $url == https://api.github.com/repos/jouni-mikkola/omatalous/releases/latest ]] || { printf 000; exit 1; }
cp "$S/release.json" "$out"; printf 200
EOF
  by_hand
  check "release channel: the release is installed and the runs are not asked" test "$RC" = 0 -a "$(cver)" = 0.2.0 -a "$(curls | grep -c actions/runs)" = 0
}

# ── the helper's Päivitä button ─────────────────────────────────────────────
t_button_takes_what_passed() {
  local good tip before
  world; before=$(head_commit); src_commit; good=$(seed_head); src_commit; tip=$(seed_head)
  runs "$(run "$tip" "$CI" queued null)" "$(run "$tip" "$PRIV" completed success)" "$(passed "$good")"
  poll update; tick
  check "button: the update is reported ok" reported ok
  check "button: the folder is at the newest commit that passed, not at the tip" at "$good"
  check "button: one call for the runs" test "$(curls | grep -c 'actions/runs')" = 1
  runs "$(passed "$tip")" "$(passed "$good")"
  rm -f "$CL/ops/last-check"; poll update "$ID2"; tick
  check "button, after the tip passed: the folder is at the tip" at "$tip"
}
t_button_waits() {
  local tip before
  world; before=$(head_commit); src_commit; tip=$(seed_head)
  runs "$(run "$tip" "$CI" in_progress null)" "$(run "$tip" "$PRIV" completed success)"
  poll update; tick
  check "button, checks running: reported failed with the sentence of the wait" bash -c "grep -q 'Uusimman version tarkistukset GitHubissa eivät ole vielä menneet läpi. Mikään ei muuttunut.' <<<\"\$1\"" x "$(report)"
  check "button, checks running: nothing built, the folder stays" bash -c "[[ \$1 == $before && \$2 == 0 ]]" x "$(head_commit)" "$(n_calls '^docker compose build')"
  echo 500 >"$S/runs.status"; poll update "$ID2"; tick
  check "button, no answer: reported failed with the sentence of no answer" bash -c "grep -q 'Uusimman version tarkistuksia ei voitu kysyä GitHubista. Mikään ei muuttunut.' <<<\"\$1\"" x "$(report)"
  check "button, no answer: the folder stays" at "$before"
}
t_button_key_off() {
  world; setenv TALOUS_CHANNEL=source; src_commit
  poll update; tick
  check "button, key off: the newest source is installed and the runs are not asked" test "$(head_commit)" = "$(seed_head)" -a "$(curls | grep -c 'actions/runs')" = 0
}

for t in $(declare -F | awk '{print $3}' | grep '^t_'); do
  want "$t" || continue
  echo "── ${t#t_}"
  "$t"
done
echo
echo "$PASS passed, $FAILED failed"
((FAILED == 0))
