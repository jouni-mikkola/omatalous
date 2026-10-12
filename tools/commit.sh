#!/usr/bin/env bash
# `git commit` for a machine whose commits are signed by a remote signing server that sometimes answers 503.
#   tools/commit.sh -m "message" [other git commit options]
# Retries only when the signing server answered 503 ("status 503" or "HTTP 503" in the error): after 5, 15 and 45 seconds
# (COMMIT_BACKOFF="5 15 45"; pattern COMMIT_RETRY_ON). Any other failure ends at once with git's own message.
# Never commits unsigned: it refuses --no-gpg-sign (and its abbreviations), commit.gpgsign=false in an argument and a setup where commit.gpgsign is off, and it checks the new commit
# carries a signature. It refuses to go on when the index changed between two tries, so a retry never commits more
# or less than the first try would have.
# Before it commits, it runs the text rules on the Markdown the commit takes (an em dash in a plan file failed two landings
# in 0.8.6) and refuses with file and line. The forms are the module tools/repo-rules/em-dash-forms.mjs, which rule 4
# in tools/repo-rules/text-rules.ts imports too, so there is no second list. A commit with no Markdown costs nothing
# extra. It reads the index, and with -a the working tree; `git commit <paths>` is not looked at. When the module
# cannot be loaded (COMMIT_RULES_FILE; no node, or the file changed shape) it says so and goes on: `pnpm check` runs
# the rule again, and tools/test/commit.test.sh fails when the module changes shape.
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

# The forms of rule 4 come from the module tools/repo-rules/em-dash-forms.mjs, loaded as it is (it is plain JavaScript).
# Arguments: the module, 1 for the working tree and 0 for the index, the files. Exit 0 clean, 1 findings (printed as
# `  file:line  why`), 3 the module could not be loaded.
read -r -d '' TEXT_RULES_JS <<'JS'
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
const [formsFile, tree, ...files] = process.argv.slice(1);
let FORMS, isResearch;
try {
  ({ FORMS, isResearch } = await import(pathToFileURL(formsFile).href));
  if (!Array.isArray(FORMS) || !FORMS.length || !FORMS.every((f) => f.re instanceof RegExp) || typeof isResearch !== "function") throw new Error("the forms of rule 4 have another shape");
} catch (err) {
  fs.writeSync(2, `${formsFile}: ${err.message}\n`);
  process.exit(3);
}
const found = [];
for (const file of new Set(files)) {
  if (isResearch(file)) continue;
  const text = tree === "1" ? fs.readFileSync(file, "utf8") : execFileSync("git", ["show", `:${file}`], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (!FORMS.some((f) => f.re.test(text))) continue;
  text.split("\n").forEach((line, i) => {
    const form = FORMS.find((f) => f.re.test(line));
    if (form) found.push(`  ${file}:${i + 1}  ${form.name}: ${line.trim().slice(0, 80)}`);
  });
}
if (found.length) {
  fs.writeSync(1, found.slice(0, 40).join("\n") + (found.length > 40 ? `\n  ... and ${found.length - 40} more` : "") + "\n");
  process.exit(1);
}
JS

# Refuses a commit that takes Markdown the text rules would fail. -a (also in a cluster such as -am) takes the working tree.
check_markdown() {
  local forms=${COMMIT_RULES_FILE:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/repo-rules/em-dash-forms.mjs} tree=0 a top out rc
  local -a md
  for a in "$@"; do
    [[ $a == --all || $a =~ ^-[A-Za-z]*a[A-Za-z]*$ ]] && tree=1
  done
  top=$(git rev-parse --show-toplevel 2>/dev/null) || return 0
  mapfile -d '' -t md < <(
    git -C "$top" diff --cached --name-only -z --diff-filter=ACMR -- '*.md'
    ((tree)) && git -C "$top" diff --name-only -z --diff-filter=ACMR -- '*.md'
  )
  ((${#md[@]})) || return 0
  command -v node >/dev/null 2>&1 || { echo "commit.sh: node is not installed, the text rules are not run on ${#md[@]} Markdown file(s)" >&2; return 0; }
  out=$(cd "$top" && node --input-type=module -e "$TEXT_RULES_JS" "$forms" "$tree" "${md[@]}" 2>&1 </dev/null)
  rc=$?
  case $rc in
    0) ;;
    1)
      printf '%s\n' "commit.sh: the text rules (rule 4, em dash) fail on the Markdown this commit takes:" "$out" \
        "To fix: rewrite the sentence with a comma, a colon, parentheses or two sentences (CLAUDE.md, Conventions: Writing). Nothing was committed." >&2
      exit 2
      ;;
    *) echo "commit.sh: the text rules are not run, the forms could not be loaded: $out" >&2 ;;
  esac
}
check_markdown "$@"

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
    if [[ $after != "$before" ]] && ! git cat-file commit "$after" | grep '^gpgsig' >/dev/null; then
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
