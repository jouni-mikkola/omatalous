#!/usr/bin/env bash
# The generated registries of the feature modules merge by union (.gitattributes). This suite works in a throwaway
# repository with the real generator and the real .gitattributes, and asks after each way git can bring two branches
# together: is there a conflict, a half line, a doubled line, a line of a module that is gone, a line missing? And is the
# file byte for byte what `pnpm gen` writes (the order of the lines is the only thing a union merge cannot keep)?
#
#   tools/test/registry-union.test.sh [name-filter]
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
SRC=$(cd "$HERE/../.." && pwd)
PASS=0; FAILED=0
FILTER=${1:-}
pass() { PASS=$((PASS + 1)); echo "ok   $1"; }
fail() { FAILED=$((FAILED + 1)); echo "FAIL $1"; [[ -z ${2:-} ]] || echo "       $2"; }
check() { local n=$1; shift; if "$@"; then pass "$n"; else fail "$n"; fi; }

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
export GIT_AUTHOR_NAME=Test GIT_AUTHOR_EMAIL=t@example.com GIT_COMMITTER_NAME=Test GIT_COMMITTER_EMAIL=t@example.com
GEN=$SRC/tools/gen/registry.mjs
REG=packages/core/src/features/insight/registry.gen.ts
N=0 R=''
g() { git -C "$R" "$@"; }
gen() { node "$GEN" --root "$R" "$@" >/dev/null; }
# mkrepo MODULE...: a repository on main that holds these insight modules and their generated registries
mkrepo() {
  N=$((N + 1)); R=$TMP/repo$N
  git init -q -b main "$R"
  cp "$SRC/.gitattributes" "$R/"
  local m
  for m in "$@"; do mkdir -p "$R/packages/core/src/features/insight/$m"; echo "export const module = 1;" >"$R/packages/core/src/features/insight/$m/index.ts"; done
  mkdir -p "$R/packages/core/src/features/insight"
  gen; g add -A; g commit -q -m base
}
# add BRANCH ID: a branch from main that adds the module ID and its generated line, as a builder does
add() {
  g checkout -q -b "$1" main
  mkdir -p "$R/packages/core/src/features/insight/$2"; echo "export const module = 1;" >"$R/packages/core/src/features/insight/$2/index.ts"
  gen; g add -A; g commit -q -m "add $2"
}
# drop BRANCH ID: a branch from main that deletes the module ID and runs the generator
drop() {
  g checkout -q -b "$1" main
  g rm -q -r "packages/core/src/features/insight/$2"
  gen; g add -A; g commit -q -m "drop $2"
}
# the registry is whole: no marker, no half line, each line a complete export line once
whole() { ! grep -qE '^(<<<<<<<|=======|>>>>>>>)' "$R/$REG" && [[ -z $(grep -vE '^(//|export \{ module as [a-z0-9_]+ \} from "\./[a-z0-9-]+/index\.ts";$|export \{\};$)' "$R/$REG") ]] && [[ -z $(sort "$R/$REG" | uniq -d) ]]; }
# true: the lines are those of the folders, in whatever order (`pnpm gen --check`)
same_lines() { node "$GEN" --root "$R" --check >/dev/null; }
# true: the file is byte for byte what the generator writes
same_bytes() { cp "$R/$REG" "$TMP/before"; gen --force; cmp -s "$TMP/before" "$R/$REG"; local rc=$?; cp "$TMP/before" "$R/$REG"; return $rc; }
# folder_gone ID: no registry line for a module whose folder is not there
no_line_for() { ! grep -q "\"./$1/index.ts\"" "$R/$REG"; }
sorted() { [[ $(grep -c '^export { module' "$R/$REG") == "$1" ]]; }

t_neighbours() {
  mkrepo b d; add x c; add y ca
  g checkout -q x; g merge -q y -m m >/dev/null 2>&1; local rc=$?
  check "neighbouring adds: merge without a conflict" test $rc -eq 0
  check "neighbouring adds: the registry is whole" whole
  check "neighbouring adds: lines are those of the folders" same_lines
  check "neighbouring adds, ours first: byte for byte the generator's" same_bytes
  mkrepo b d; add x c; add y ca
  g checkout -q y; g merge -q x -m m >/dev/null 2>&1
  check "neighbouring adds, other way: the registry is whole" whole
  check "neighbouring adds, other way: lines are those of the folders" same_lines
  echo "     other way, same bytes: $(same_bytes && echo yes || echo 'NO, the lines of the two branches come in the order of the merge')"
}
t_apart() {
  mkrepo b d f h; add x c; add y g
  g checkout -q x; g merge -q y -m m >/dev/null 2>&1
  check "adds in different gaps: no conflict, byte for byte the generator's" same_bytes
}
t_delete_and_add() {
  mkrepo b c d; drop x c; add y ca
  g checkout -q x; g merge -q y -m m >/dev/null 2>&1; local rc=$?
  echo "     delete c beside add ca: merge rc=$rc, line for c kept: $(no_line_for c && echo no || echo YES)"
  check "delete beside add: the registry is whole" whole
  check "delete beside add: the stale line of the deleted module is caught by the check" bash -c "! node '$GEN' --root '$R' --check >/dev/null"
  gen
  check "delete beside add: pnpm gen removes it and leaves the new line" bash -c "node '$GEN' --root '$R' --check >/dev/null && ! grep -q './c/index.ts' '$R/$REG' && grep -q './ca/index.ts' '$R/$REG'"
  mkrepo b c d f; drop x c; add y g
  g checkout -q x; g merge -q y -m m >/dev/null 2>&1
  check "delete and add in different gaps: byte for byte the generator's" same_bytes
}
t_rebase() {
  mkrepo b d; add x c; add y ca
  g checkout -q y; g rebase x >/dev/null 2>&1; local rc=$?
  check "rebase of an adjacent add onto another: no stop" test $rc -eq 0
  check "rebase: the registry is whole" whole
  check "rebase: lines are those of the folders" same_lines
  echo "     rebase, same bytes: $(same_bytes && echo yes || echo NO)"
}
t_cherry_pick() {
  mkrepo b d; add x c; add y ca
  g checkout -q x; g cherry-pick y >/dev/null 2>&1; local rc=$?
  check "cherry-pick of an adjacent add: no stop" test $rc -eq 0
  check "cherry-pick: the registry is whole" whole
  check "cherry-pick: lines are those of the folders" same_lines
  mkrepo b d; add x c; add y ca
  g checkout -q y; g cherry-pick x >/dev/null 2>&1
  check "cherry-pick the other way: lines are those of the folders" same_lines
  echo "     cherry-pick, other way, same bytes: $(same_bytes && echo yes || echo NO)"
}
t_three_landed() {
  mkrepo b d; add x c; add y ca; add z cb
  g checkout -q main
  local br rc=0
  for br in x y z; do g cherry-pick "$br" >/dev/null 2>&1 || rc=1; done
  check "three adds in one gap, landed one after another: no stop" test $rc -eq 0
  check "three adds: the registry is whole" whole
  check "three adds: lines are those of the folders" same_lines
  echo "     three adds landed in order x y z, same bytes: $(same_bytes && echo yes || echo NO)"
  mkrepo b d; add x c; add y ca; add z cb
  g checkout -q main; rc=0
  for br in z y x; do g cherry-pick "$br" >/dev/null 2>&1 || rc=1; done
  check "three adds landed in the order z y x: lines are those of the folders" same_lines
  echo "     three adds landed in order z y x, same bytes: $(same_bytes && echo yes || echo NO)"
}
t_stale_line_is_caught() {
  mkrepo b c d
  sed -i '/"\.\/c\/index.ts"/d' "$R/$REG"
  check "a registry that lost a line is not the folders' lines" bash -c "! node '$GEN' --root '$R' --check >/dev/null"
  gen; sed -i 's/^export { module as d }/export { module as d_x }/' "$R/$REG"
  check "a half-edited line is not the folders' lines" bash -c "! node '$GEN' --root '$R' --check >/dev/null"
  gen; printf 'export { module as b } from "./b/index.ts";\n' >>"$R/$REG"
  check "a doubled line is not the folders' lines" bash -c "! node '$GEN' --root '$R' --check >/dev/null"
}

for t in t_neighbours t_apart t_delete_and_add t_rebase t_cherry_pick t_three_landed t_stale_line_is_caught; do
  [[ -z $FILTER || $t == *$FILTER* ]] && $t
done
echo "$PASS passed, $FAILED failed"
((FAILED == 0))
