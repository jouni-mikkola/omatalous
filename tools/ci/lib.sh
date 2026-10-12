# shellcheck shell=bash
# What upgrade-run.sh and drills-lib.sh both stand on, sourced by them once their variables are set (DIR, URL, JAR, NODE,
# REMOTE and DEV; DEADLINE, the drills' time limit, is optional). Each helper is defined here and nowhere else.
# It defines functions and runs nothing.

dc() { (cd "$DIR" && docker compose "$@"); }
# argument "baseline": the shim is about the checkout as it is; otherwise about the version the next update pulls
# (branch ci of the remote)
shim() { if [[ -n ${UPGRADE_BUILD_SHIM:-} ]]; then (cd "$DIR" && "$UPGRADE_BUILD_SHIM" "${1:-next}"); fi; }
# pipefail inside, so that "unknown" means the same whether or not the caller set it
app_version() { (set -o pipefail; dc exec -T banking "${NODE[@]}" dist/node.js version 2>/dev/null | tail -1 | awk '{print $1}') || echo unknown; }
migrations() { dc exec -T banking "${NODE[@]}" -e 'const d = new (require("node:sqlite").DatabaseSync)("/data/banking.db", { readOnly: true }); for (const r of d.prepare("SELECT name FROM _migrations ORDER BY name").all()) console.log(r.name);'; }

# golden_rows FILE: the rows that must survive an update, a rollback or a restore, of a database file inside the
# container (/data/banking.db is the live one), one line each, sorted: rows and sums of every user's transactions,
# accounts, rules, the user's own choices (categories, marks, expected bills, Optimoi), the settings and the use members
# said of an account. Read only. A table a baseline lacks counts 0 or lists nothing, which is what a new empty table
# gives too. It is the one reader of those rows: upgrade-run.sh's `golden` and the drills' `golden_of` call it.
golden_rows() {
  dc exec -T banking "${NODE[@]}" -e '
    const d = new (require("node:sqlite").DatabaseSync)(process.argv[1], { readOnly: true });
    const p = (...a) => console.log(a.join(" "));
    const has = (t) => d.prepare("SELECT 1 AS x FROM sqlite_master WHERE type = \x27table\x27 AND name = ?").get(t) !== undefined;
    for (const r of d.prepare("SELECT u.username AS u, count(t.id) AS n, coalesce(sum(t.amount_cents),0) AS s FROM users u LEFT JOIN transactions t ON t.user_id = u.id GROUP BY u.id ORDER BY u.username").all()) p("tx", r.u, r.n, r.s);
    p("accounts", d.prepare("SELECT count(*) AS n FROM accounts").get().n);
    p("rules", d.prepare("SELECT count(*) AS n FROM category_rules").get().n);
    for (const t of ["user_marks", "expected_bills", "optimise_inputs", "optimise_states", "optimise_snapshots"]) for (const r of d.prepare("SELECT u.username AS u, " + (has(t) ? "(SELECT count(*) FROM " + t + " x WHERE x.user_id = u.id)" : "0") + " AS n FROM users u ORDER BY u.username").all()) p(t, r.u, r.n);
    for (const r of d.prepare("SELECT id, category FROM transactions WHERE category_source = \x27user\x27 ORDER BY id").all()) p("user-row", r.id, r.category);
    for (const r of d.prepare("SELECT key, value FROM settings WHERE key = \x27instance_settings\x27").all()) p("setting", r.key, r.value);
    // a said use, by the name of the member (a dash: the holders who are no member)
    if (has("account_use")) for (const r of d.prepare("SELECT x.account_key AS k, coalesce(u.username, \x27-\x27) AS u, x.weight AS w FROM account_use x LEFT JOIN users u ON u.id = x.user_id").all()) p("account_use", r.k, r.u, r.w);' "$1" | sort
}

# ── the app from outside ────────────────────────────────────────────────────
app_ok() { curl -fsS --max-time 5 "$URL/api/health"; }
# until_ok SECONDS cmd...: the command succeeds before SECONDS (or before the drills' DEADLINE, when they set one)
until_ok() {
  local end=$((SECONDS + $1)); shift
  while :; do
    "$@" >/dev/null 2>&1 && return 0
    ((SECONDS >= end || SECONDS >= ${DEADLINE:-$end})) && return 1
    sleep 2
  done
}
curlj() { curl -fsS --max-time 60 -H 'Content-Type: application/json' -H 'X-Requested-With: fetch' "$@"; }
# api ARGS...: curlj as the signed-in user whose cookie is in $JAR
api() { curlj -b "$JAR" -c "$JAR" "$@"; }

# ── the releases the scripts push ───────────────────────────────────────────
# push_release MESSAGE SNIPPET: a commit on the remote's branch ci, made in a clone of its own (DEV). SNIPPET is a shell command
# line, or the name of a function, run in that clone; it changes its files. A subshell, so the cd stays in it.
push_release() (
  [[ -d $DEV ]] || git clone -q --branch ci "$REMOTE" "$DEV" || exit 1
  git -C "$DEV" pull -q --ff-only origin ci || exit 1
  cd "$DEV" || exit 1
  # Not tested with `||`: under set -e (upgrade-run.sh) the first failing command of the snippet ends the run; the drills
  # run without it and read the status.
  eval "$2"
  (($? == 0)) || exit 1
  git add -A || exit 1
  git diff --cached --quiet || git commit -q -m "$1" || exit 1
  git push -q origin HEAD:ci
)
