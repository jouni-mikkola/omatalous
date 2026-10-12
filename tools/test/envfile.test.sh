#!/usr/bin/env bash
# Tests for scripts/lib/envfile.sh, the one writer of .env. Every scenario has a folder of its own under a temporary
# one, and the file it writes is made up there. A program is replaced only where a scenario says so.
#
#   tools/test/envfile.test.sh [name-filter]
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
SRC=$(cd "$HERE/../.." && pwd)
FILTER=${1:-}
PASS=0; FAILED=0
pass() { PASS=$((PASS + 1)); echo "ok   $1"; }
fail() { FAILED=$((FAILED + 1)); echo "FAIL $1"; [[ -z ${2:-} ]] || echo "       $2"; }
check() { local n=$1; shift; if "$@"; then pass "$n"; else fail "$n"; fi; }
want() { [[ -z $FILTER || $1 == *$FILTER* ]]; }

TMPBASE=$(mktemp -d)
trap 'rm -rf "$TMPBASE"' EXIT
# shellcheck source=../../scripts/lib/envfile.sh
. "$SRC/scripts/lib/envfile.sh"

N=0; D=""; F=""
# a folder D of its own, and in it the file F with the bytes given (as printf %b reads them) and the mode given (600)
file() { N=$((N + 1)); D=$TMPBASE/$N; mkdir -p "$D"; F=$D/.env; printf '%b' "$1" >"$F"; chmod "${2:-600}" "$F"; }
bytes() { printf '%b' "$1" | cmp -s - "$2"; }
# F holds exactly these bytes, and nothing is left beside it
is() { bytes "$1" "$F" && [[ ! -e $F.new && ! -L $F.new ]]; }
mode() { [[ $(stat -c %a "$F") == "$1" ]]; }
inode() { stat -c %i "$F"; }
not() { ! "$@"; }
# the write is made and F then holds the bytes given:      wrote BYTES WHERE MODE ITEM...
wrote() { local b=$1; shift; envfile_write "$F" "$@" && is "$b"; }
# the write is refused and F holds the bytes given still:   refused BYTES WHERE MODE ITEM...
refused() { local b=$1; shift; ! envfile_write "$F" "$@" && is "$b"; }
# a file that is not the writer's, which a link beside F may point at
other() { printf 'not mine\n' >"$D/other"; chmod 644 "$D/other"; }
other_same() { [[ $(cat "$D/other") == "not mine" && $(stat -c %a "$D/other") == 644 ]]; }

t_a_key_is_set() {
  file 'A=1\nKEY=old\nB=2\n'
  check "set: the line is replaced where it stands" wrote 'A=1\nKEY=new\nB=2\n' place 600 KEY=new
  check "set: a key the file does not have becomes the last line" wrote 'A=1\nKEY=new\nB=2\nNEW=x\n' place 600 NEW=x
  check "set: several keys in one write, each where it stood or last" wrote 'A=9\nKEY=new\nB=2\nNEW=y\nC=3\n' place 600 C=3 A=9 NEW=y
  file 'K=1\nA=1\nK=2\nB=2\nK=3\nC=3\n'
  check "set: several lines of the key become one, where the last stood" wrote 'A=1\nB=2\nK=4\nC=3\n' place 600 K=4
  file 'KEY_2=a\nKEY=b\nXKEY=c\n'
  check "set: a key whose name is a part of another's is not that key" wrote 'KEY_2=a\nKEY=d\nXKEY=c\n' place 600 KEY=d
  file 'A=1\n'
  # shellcheck disable=SC2016
  check "set: a value is written as it is given, whatever it holds" wrote 'A=1\nK=a=b= $HOME `id` "q" \\n *\n' place 600 'K=a=b= $HOME `id` "q" \n *'
  check "set: an empty value is a value" wrote 'A=\nK=\n' place 600 K= A=
  file 'A=1\nK=1\nB=2\nK=2\n'
  check "a key without a value: every line of it goes" wrote 'A=1\nB=2\n' place 600 K
  check "a key without a value that the file does not have changes nothing" wrote 'A=1\nB=2\n' place 600 NONE
}

t_a_key_is_kept() {
  file 'A=1\nK=keep me\nB=2\nT=3\n'
  check "kept, place: a kept key stays where it stands" wrote 'A=2\nK=keep me\nB=2\nT=3\n' place 600 +K A=2
  check "kept, end: the keys named leave their place and follow the rest in the order given" wrote 'A=2\nB=9\nK=keep me\n' end 600 B=9 +K T
  check "kept, end: a kept key the file does not have is not written" wrote 'A=2\nB=9\nK=keep me\n' end 600 +NONE +K
  file 'K=1\nA=1\nK=2\n'
  check "kept, end: several lines of a kept key become its last line" wrote 'A=1\nK=2\n' end 600 +K
  file 'A=1\nB=2\nC=3\n'
  check "end: a key that is set moves after the rest, once" wrote 'B=2\nC=4\nA=5\n' end 600 C=4 A=5
}

t_an_unknown_key_survives() {
  local rest='# a comment\n\nFOO = bar \r\nno equals sign\nX=a\0b\nexport Y=1\n\tZ=tab\n'
  file "${rest}K=1\nLAST=ä\n"
  check "unknown, place: every other line stays byte for byte" wrote "${rest}K=2\nLAST=ä\n" place 600 K=2
  check "unknown, end: every other line stays byte for byte" wrote "${rest}LAST=ä\nK=3\n" end 600 K=3
  check "unknown: the NUL byte of a line is in the file still" test "$(tr -dc '\0' <"$F" | wc -c)" = 1
}

t_no_final_newline() {
  file 'A=1\nK=1'
  check "no newline: a key on the last line is replaced, and the line stays without one" wrote 'A=1\nK=2' place 600 K=2
  check "no newline: another key is replaced, and the last line stays as it is" wrote 'A=3\nK=2' place 600 A=3
  check "no newline: a new key gets a line of its own" wrote 'A=3\nK=2\nN=1\n' place 600 N=1
  file 'A=1\nK=1'
  check "no newline: a last line that goes leaves the rest whole" wrote 'A=1\n' place 600 K
  file 'A=1\nK=1'
  check "no newline, end: the key that moves is a whole line" wrote 'A=1\nK=2\n' end 600 K=2
  file 'K=1\nB=2'
  check "no newline, end: the last line is ended before the one added" wrote 'B=2\nK=2\n' end 600 K=2
  file 'A=1\nK=1'
  check "no newline, end: a kept last line is ended before what follows it" wrote 'K=1\nA=2\n' end 600 +K A=2
  file 'A=1\nK=1'
  check "no newline, end: a kept last line that comes last is ended too" wrote 'A=2\nK=1\n' end 600 A=2 +K
  file ''
  check "an empty file gets the key as its only line" wrote 'K=1\n' place 600 K=1
}

no_chown() { (chown() { return 1; }; "$@"); }
t_the_mode_is_kept() {
  local i
  file 'A=1\n' 640
  check "mode same: the file is written" wrote 'A=2\n' place same A=2
  check "mode same: with the mode it had" mode 640
  file 'A=1\n' 644
  check "mode 600: the file is written" wrote 'A=2\n' place 600 A=2
  check "mode 600: and is this user's alone" mode 600
  file 'A=1\n' 644; i=$(inode)
  check "mode 600: a file that says so already, with another mode, is written" wrote 'A=1\n' place 600 A=1
  check "mode 600: as a new file that is this user's alone" test "$(inode)" != "$i" -a "$(stat -c %a "$F")" = 600
  i=$(inode)
  check "a file that would not change is not written again" wrote 'A=1\n' place 600 A=1
  check "it is the same file still" test "$(inode)" = "$i"
  file 'A=1\n' 640; i=$(inode)
  check "mode same: a file that would not change is not written again" wrote 'A=1\n' place same A=1
  check "mode same: it is the same file still, with its mode" test "$(inode)" = "$i" -a "$(stat -c %a "$F")" = 640
  check "a file that changes is written" wrote 'A=2\n' place same A=2
  check "as a new file under the old name" test "$(inode)" != "$i"
  file 'A=1\n' 640
  check "mode same: an owner that cannot be given: nothing is written" no_chown refused 'A=1\n' place same A=2
  check "mode 600: the owner is not asked for" no_chown wrote 'A=2\n' place 600 A=2
}

no_file() { ! envfile_write "$D/none" place 600 K=1 && [[ ! -e $D/none && ! -e $D/none.new ]]; }
empty_file() { : >"$D/none" && envfile_write "$D/none" place 600 K=1 && [[ $(cat "$D/none") == K=1 ]]; }
folder() { mkdir "$D/dir" && ! envfile_write "$D/dir" place 600 K=1 && [[ -d $D/dir && ! -e $D/dir.new ]]; }
# a link to a device reads as an empty file: it must not become a file with the key in it
device() { ln -s /dev/null "$D/dev" && ! envfile_write "$D/dev" place 600 K=1 && [[ -L $D/dev && ! -e $D/dev.new ]]; }
t_refusals() {
  local bad rc
  file 'A=1\n'
  check "a file that is not there is not made" no_file
  check "one that is there and empty is written" empty_file
  check "a folder is no file" folder
  check "what is no file is not replaced by one" device
  for bad in '1K=x' 'K K=x' 'K-1=x' '=x' '' '+' 'K.=x' 'K*' '+K[1]'; do
    check "a key that is no name is refused, place: '$bad'" refused 'A=1\n' place 600 A=2 "$bad"
    check "a key that is no name is refused, end: '$bad'" refused 'A=1\n' end 600 A=2 "$bad"
  done
  check "a name with a small letter, a digit and an underscore is a key" wrote 'A=1\n_k9=x\n' place 600 _k9=x
  file 'A=1\n'
  check "a place that is neither place nor end is refused" refused 'A=1\n' top 600 A=2
  check "a mode that is neither same nor 600 is refused" refused 'A=1\n' place 644 A=2
  file 'A=1\nB=2\n'
  rc=0; (printf() { return 1; }; envfile_write "$F" place 600 A=2) || rc=$?
  check "a line that cannot be written: the write says so" test "$rc" = 1
  check "a line that cannot be written: the file is as it was" is 'A=1\nB=2\n'
  rc=0; (sed() { return 1; }; envfile_write "$F" place 600 A=2) || rc=$?
  check "lines that cannot be copied: the write says so" test "$rc" = 1
  check "lines that cannot be copied: the file is as it was" is 'A=1\nB=2\n'
  rc=0; (mv() { return 1; }; envfile_write "$F" place 600 A=2) || rc=$?
  check "a rename that fails: the write says so" test "$rc" = 1
  check "a rename that fails: the file is as it was" is 'A=1\nB=2\n'
  check "and the same write is made when nothing stops it" wrote 'A=2\nB=2\n' place 600 A=2
}

restored() { envfile_restore "$F" "$D/prev" && cmp -s "$F" "$D/prev" && [[ ! -e $F.new && ! -L $F.new ]]; }
# what a killed writer left as FILE.new, or what someone put there, is removed first and never written into
t_a_file_left_at_new() {
  file 'A=1\n'; printf 'half a file\n' >"$F.new"
  check "left behind: a new file of a killed writer is not part of the next one" wrote 'A=2\n' place 600 A=2
  file 'A=1\n'; other; ln -s "$D/other" "$F.new"
  check "left behind: a link there is removed and the write is made" wrote 'A=2\n' place 600 A=2
  check "left behind: what the link pointed at is as it was" other_same
  check "left behind: the file is a file and no link" test -f "$F" -a ! -L "$F"
  file 'A=1\n'; other; printf 'B=2\n' >"$D/prev"; ln -s "$D/other" "$F.new"
  check "left behind, restore: a link there is removed and the copy is made" restored
  check "left behind, restore: what the link pointed at is as it was" other_same
}

refuses_new() { ! envfile_new "$F" 2>/dev/null; }
new_made() { envfile_new "$F" && [[ -f $F.new && ! -L $F.new && ! -s $F.new && $(stat -c %a "$F.new") == 600 ]]; }
# the new file is made, never opened: what appears at FILE.new after the removal is not written through
t_the_new_file_goes_through_no_link() {
  local rc=0
  file 'A=1\n'; other; ln -s "$D/other" "$F.new"
  check "a link to a file is there: no new file" refuses_new
  check "a link to a file: what it points at is as it was" other_same
  rm "$F.new"; ln -s "$D/nothing" "$F.new"
  check "a link to nothing is there: no new file" refuses_new
  check "a link to nothing: nothing is made behind it" test ! -e "$D/nothing"
  rm "$F.new"; printf 'x\n' >"$F.new"
  check "a file is there: no new file" refuses_new
  check "a file is there: it is left as it is" test "$(cat "$F.new")" = x
  rm "$F.new"
  check "nothing is there: an empty file that is this user's alone" new_made
  # the link appears right after the writer removed what was there
  rm "$F.new"
  (rm() { command rm "$@"; ln -s "$D/other" "$F.new"; }; envfile_write "$F" place 600 A=2) 2>/dev/null || rc=$?
  check "a link that appears after the removal: the write is refused" test "$rc" = 1
  check "a link that appears after the removal: the file is as it was" bytes 'A=1\n' "$F"
  check "a link that appears after the removal: what the link points at is as it was" other_same
}

# The writer is killed (kill -9, as a power cut would) at the two places a half file could come from. The new file being
# there, whole, tells that the first kill came between it and the rename.
t_a_killed_write_leaves_the_old_file() {
  local rc=0
  file 'A=1\nK=old\nB=2\n' 640
  { (mv() { kill -KILL "$BASHPID"; }; envfile_write "$F" place same K=new); rc=$?; } 2>/dev/null
  check "killed before the rename: the writer died there" test "$rc" = 137
  check "killed before the rename: the new file was whole beside the old one" bytes 'A=1\nK=new\nB=2\n' "$F.new"
  check "killed before the rename: the old file is whole" bytes 'A=1\nK=old\nB=2\n' "$F"
  check "killed before the rename: with its mode" mode 640
  check "killed before the rename: the next write removes what was left and is whole" wrote 'A=1\nK=next\nB=2\n' place same K=next
  file 'A=1\nK=old\nB=2\n'; rc=0
  { (sed() { kill -KILL "$BASHPID"; }; envfile_write "$F" place 600 K=new); rc=$?; } 2>/dev/null
  check "killed while the new file is written: the writer died there" test "$rc" = 137 -a -e "$F.new"
  check "killed while the new file is written: the old file is whole" bytes 'A=1\nK=old\nB=2\n' "$F"
  check "killed while the new file is written: the next write is whole" wrote 'A=1\nK=next\nB=2\n' place 600 K=next
}

restore_refused() { ! envfile_restore "$F" "$D/none" 2>/dev/null && is 'B=2\nC=3'; }
t_restore() {
  local i
  file 'A=1\n' 644; printf 'B=2\nC=3' >"$D/prev"; chmod 644 "$D/prev"
  check "restore: the file becomes the other, byte for byte" restored
  check "restore: it is this user's alone" mode 600
  i=$(inode)
  check "restore: a file that is the copy already is not written again" restored
  check "restore: it is the same file still" test "$(inode)" = "$i"
  check "restore: a copy that is not there: refused, and the file is as it was" restore_refused
  rm "$F"
  check "restore: a file that is gone comes back" restored
}

t_the_new_file_is_whole_before_the_rename() {
  file 'A=1\nK=1\n' 644
  check "stage: made" envfile_stage "$F" end K=2
  check "stage: the file is not touched" bytes 'A=1\nK=1\n' "$F"
  check "stage: nor its mode" mode 644
  check "stage: the new file is whole" bytes 'A=1\nK=2\n' "$F.new"
  check "stage: and this user's alone" test "$(stat -c %a "$F.new")" = 600
  check "commit: the new file takes the name" envfile_commit "$F" 600
  check "commit: nothing is left beside it" is 'A=1\nK=2\n'
}

# every program the writer runs is in front of PATH as a script that notes its arguments and then runs the real one
t_a_value_is_no_argument_of_a_program() {
  local p rc=0
  file 'A=1\nTOKEN=made-up-old\nB=2\n' 640; mkdir "$D/bin"; printf 'B=made-up-kept\n' >"$D/prev"
  for p in grep sed cut tr tail wc cmp stat chown chmod sync mv rm cat; do
    printf '#!/bin/sh\nprintf "%%s\\n" "%s $*" >>"%s/args"\nexec "%s" "$@"\n' "$p" "$D" "$(command -v "$p")" >"$D/bin/$p"
  done
  chmod +x "$D"/bin/*
  (PATH=$D/bin:$PATH; hash -r
    envfile_write "$F" place same TOKEN=made-up-new A=2 && envfile_write "$F" end 600 TOKEN=made-up-newer +A B && envfile_restore "$F" "$D/prev") || rc=$?
  check "arguments: the three writes were made" test "$rc" = 0
  check "arguments: the file is what the last of them wrote" is 'B=made-up-kept\n'
  check "arguments: the programs were seen, and a key is an argument of grep" grep -q '^grep .*TOKEN=' "$D/args"
  check "arguments: no value was an argument of any program" not grep -q 'made-up-\(old\|new\|newer\)' "$D/args"
}

for t in $(declare -F | awk '{print $3}' | grep '^t_'); do
  want "$t" || continue
  echo "── ${t#t_}"
  "$t"
done
echo
echo "$PASS passed, $FAILED failed"
((FAILED == 0))
