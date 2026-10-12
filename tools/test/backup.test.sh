#!/usr/bin/env bash
# Tests for scripts/backup.sh with stub docker, age, crontab, mountpoint, a cp that can fail, a date that can stand still
# and a cmp that can plant a link. Nothing touches the real Docker, the real crontab or a real mount. It covers what the
# helper's empty environment needs (settings from .env), the copy to BACKUP_COPY_TO (also when someone has put links on
# the share) and --schedule / --unschedule.
#
#   tools/test/backup.test.sh [name-filter]
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
SRC=$(cd "$HERE/../.." && pwd)
FILTER=${1:-}
PASS=0; FAILED=0
check() { local n=$1; shift; if "$@"; then PASS=$((PASS + 1)); echo "ok   $n"; else FAILED=$((FAILED + 1)); echo "FAIL $n"; fi; }
want() { [[ -z $FILTER || $1 == *$FILTER* ]]; }

T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
# The system tools without the ones a test decides about, so that "no age" and "no crontab" are commands that do not exist.
SYS=$T/sys; mkdir -p "$SYS" "$T/bin" "$T/agebin" "$T/cronbin"
for f in /usr/bin/* /usr/sbin/*; do
  case ${f##*/} in crontab | docker | age | mountpoint | cp | cmp | date) ;; *) ln -sf "$f" "$SYS/" 2>/dev/null ;; esac
done
# a database that passes backup.sh's own checks: the header, 8192 bytes
{ printf 'SQLite format 3\0'; head -c 8176 /dev/zero; } >"$T/fixture.db"

cat >"$T/bin/docker" <<'EOF'
#!/usr/bin/env bash
echo "docker $*" >>"$STUB/calls.log"
case " $* " in
  " compose version "*) exit 0 ;;
  *" compose ps "*) [[ -e $STUB/down ]] || echo abc123; exit 0 ;;
  *" compose cp "*) /usr/bin/cp "$STUB/fixture.db" "${@: -1}"; exit $? ;;
  *'statSync("/data/backup.db").size'*) echo 8192; exit 0 ;;
  *"cat /secrets/app_secret"*) printf 'SECRET-VALUE-XYZ'; exit 0 ;;
esac
exit 0
EOF
cat >"$T/bin/mountpoint" <<'EOF'
#!/usr/bin/env bash
[[ ${1:-} == -q ]] && shift
grep -qxF -- "$1" "$STUB/mounts" 2>/dev/null
EOF
# a share that fills up: the copy to a hidden .part file fails
cat >"$T/bin/cp" <<'EOF'
#!/usr/bin/env bash
if [[ -e $STUB/cpfail && ${*: -1} == *.part ]]; then echo "cp: no space left on device" >&2; exit 1; fi
exec /usr/bin/cp "$@"
EOF
# the run's stamp (the part of every file name that follows from the time) can be fixed, so a test can put links at the
# names the script will use
cat >"$T/bin/date" <<'EOF'
#!/usr/bin/env bash
if [[ ${1:-} == +%Y%m%d-%H%M%S && -e $STUB/stamp ]]; then cat "$STUB/stamp"; exit 0; fi
exec /usr/bin/date "$@"
EOF
# cmp runs between the copy and the rename: with STUB/plant-final it puts a link to that folder at the final name, the
# way someone on the share could in that moment (the name is the part file's, without the dot and the .part)
cat >"$T/bin/cmp" <<'EOF'
#!/usr/bin/env bash
if [[ -e $STUB/plant-final ]]; then
  last=${*: -1}; b=${last##*/}; b=${b#.}; b=${b%.part}
  ln -s "$(cat "$STUB/plant-final")" "${last%/*}/$b"
fi
exec /usr/bin/cmp "$@"
EOF
cat >"$T/agebin/age" <<'EOF'
#!/usr/bin/env bash
rec=; out=; in=
while (($#)); do case $1 in -r) rec=$2; shift 2 ;; -o) out=$2; shift 2 ;; *) in=$1; shift ;; esac; done
echo "$rec" >>"$STUB/age.log"
{ echo "AGE-ENCRYPTED"; if [[ -n $in ]]; then cat "$in"; else cat; fi; } >"$out"
EOF
cat >"$T/cronbin/crontab" <<'EOF'
#!/usr/bin/env bash
f=$STUB/crontab
echo "crontab $*" >>"$STUB/cron-calls.log"
case ${1:-} in
  -l) [[ -e $STUB/croncorrupt ]] && { echo "crontab: permission denied" >&2; exit 1; }
      [[ -e $f ]] && cat "$f" || { echo "no crontab for nobody" >&2; exit 1; } ;;
  -r) rm -f "$f" ;;
  -) cat >"$f" ;;
esac
EOF
chmod +x "$T"/bin/* "$T"/agebin/* "$T"/cronbin/*

PATH_FULL=$T/bin:$T/agebin:$T/cronbin:$SYS
PATHX=$PATH_FULL

# A world: a clone with the two scripts a backup needs, a folder of stub state S and a home. Not a git clone.
new_world() {
  W=$(mktemp -d -p "$T"); S=$W/stub; CL=$W/clone
  mkdir -p "$S" "$CL/scripts/lib" "$W/home"
  cp "$SRC/scripts/backup.sh" "$CL/scripts/"; cp "$SRC/scripts/lib/dbcopy.sh" "$CL/scripts/lib/"
  cp "$T/fixture.db" "$S/fixture.db"
  PATHX=$PATH_FULL
}
# a second clone in the same world and the same stub state (the crontab is shared)
second_clone() { CL2=$W/$1; mkdir -p "$CL2/scripts/lib"; cp "$SRC/scripts/backup.sh" "$CL2/scripts/"; cp "$SRC/scripts/lib/dbcopy.sh" "$CL2/scripts/lib/"; }
# bk [VAR=value...] [-- args...]: backup.sh in the clone with an empty environment (as the helper and cron run it),
# plus the variables given. Output goes to W/out, the exit status to RC.
CLONE_RUN=
bk() {
  local envs=() args=() dir=${CLONE_RUN:-$CL}
  while (($#)) && [[ $1 != -- ]]; do envs+=("$1"); shift; done
  (($#)) && shift
  args=("$@")
  (cd "$dir" && env -i PATH="$PATHX" HOME="$W/home" STUB="$S" "${envs[@]}" ./scripts/backup.sh "${args[@]}") >"$W/out" 2>&1
  RC=$?
}
envfile() { printf '%s\n' "$@" >"$CL/.env"; }
files_in() { ls -1 "$1" 2>/dev/null | tr '\n' ' '; }
calls() { grep -c "$1" "$S/calls.log" 2>/dev/null || true; }
mounted() { printf '%s\n' "$@" >"$S/mounts"; }

t_plain() {
  new_world
  bk
  check "plain: a good run exits 0" test "$RC" = 0
  check "plain: one gzip file, no encrypted file, no app secret file" bash -c "[[ \$(ls '$CL/backups'/talous-*.db.gz | wc -l) = 1 && \$(ls '$CL/backups' | wc -l) = 1 ]]"
  check "plain: the output says the app secret is not included" grep -q 'app secret not included' "$W/out"
  check "plain: the secret itself is never printed" bash -c "! grep -q SECRET-VALUE '$W/out'"
  check "plain: no copy is attempted without BACKUP_COPY_TO" bash -c "! grep -qi 'copied\|warning' '$W/out'"
}

t_env_file() {
  new_world
  envfile 'INSTANCE_NAME=banking-app' 'BACKUP_AGE_RECIPIENT=age1fromenvfile' 'HOST_PORT=8080'
  bk
  check "env file: an empty environment still encrypts with the key from .env" bash -c "[[ $RC = 0 ]] && ls '$CL/backups'/talous-*.db.gz.age >/dev/null && ls '$CL/backups'/talous-*.app_secret.age >/dev/null"
  check "env file: no plain-text copy is left" bash -c "! ls '$CL/backups' | grep '\.db\.gz\$' >/dev/null"
  check "env file: age got the key from .env" grep -qx age1fromenvfile "$S/age.log"
  check "env file: the app secret is in an encrypted file only" bash -c "grep -q SECRET-VALUE '$CL/backups'/talous-*.app_secret.age && head -1 '$CL/backups'/talous-*.app_secret.age | grep -x AGE-ENCRYPTED >/dev/null"
  check "env file: neither the key nor the secret is printed" bash -c "! grep -q 'age1fromenvfile\|SECRET-VALUE' '$W/out'"
  check "env file: the output says encrypted" grep -q 'encrypted' "$W/out"

  # the shell's value wins over .env
  rm -rf "$CL/backups" "$S/age.log"
  bk BACKUP_AGE_RECIPIENT=age1fromshell
  check "env file: a key in the environment wins over .env" bash -c "grep -qx age1fromshell '$S/age.log' && ! grep -q age1fromenvfile '$S/age.log'"

  # an empty variable counts as none
  rm -rf "$CL/backups" "$S/age.log"
  bk BACKUP_AGE_RECIPIENT=
  check "env file: an empty variable is no key, .env is read" grep -qx age1fromenvfile "$S/age.log"
}

t_env_file_forms() {
  local form want_key=age1abc
  for form in 'BACKUP_AGE_RECIPIENT="age1abc"' "BACKUP_AGE_RECIPIENT='age1abc'" 'BACKUP_AGE_RECIPIENT=age1abc # my key' $'BACKUP_AGE_RECIPIENT=age1abc\r' 'BACKUP_AGE_RECIPIENT=  age1abc  ' $'BACKUP_AGE_RECIPIENT=age1old\nBACKUP_AGE_RECIPIENT=age1abc'; do
    new_world; envfile "$form"; bk
    check "env file forms: $(printf '%q' "$form") gives the key" bash -c "[[ $RC = 0 ]] && [[ \$(tail -1 '$S/age.log') = $want_key ]]"
  done
  new_world; envfile '#BACKUP_AGE_RECIPIENT=age1abc' ' BACKUP_AGE_RECIPIENT=age1abc' 'XBACKUP_AGE_RECIPIENT=age1abc'
  bk
  check "env file forms: a comment, an indented line and another name are no key" bash -c "[[ $RC = 0 && ! -e '$S/age.log' ]]"
  # .env is data: nothing in it runs
  new_world; envfile "BACKUP_AGE_RECIPIENT=age1abc; touch $W/pwn" "BACKUP_COPY_TO=\$(touch $W/pwn2)"
  bk
  check "env file forms: shell syntax in .env is not run" bash -c "[[ ! -e '$W/pwn' && ! -e '$W/pwn2' ]]"
}

t_age_missing() {
  new_world; envfile 'BACKUP_AGE_RECIPIENT=age1abc'
  PATHX=$T/bin:$T/cronbin:$SYS
  bk
  check "age missing: a key in .env and no age is a failure, not a plain-text backup" bash -c "[[ $RC != 0 ]] && grep -q 'age is missing' '$W/out'"
  check "age missing: no file was written" bash -c "[[ -z \$(ls '$CL/backups' 2>/dev/null) ]]"
}

t_not_running() {
  new_world; touch "$S/down"; envfile "BACKUP_COPY_TO=$W/nas"; mounted "$W/nas"; mkdir -p "$W/nas"
  bk
  check "not running: the app is down, the run fails and nothing is copied" bash -c "[[ $RC != 0 ]] && grep -q 'not running' '$W/out' && [[ -z \$(ls '$W/nas') ]]"
}

t_copy() {
  new_world; envfile "BACKUP_COPY_TO=$W/nas/omatalous"; mounted "$W/nas"
  bk
  check "copy: a mounted parent, the folder is made and the new file is copied" bash -c "[[ $RC = 0 ]] && cmp -s '$CL/backups'/talous-*.db.gz '$W/nas/omatalous'/talous-*.db.gz"
  check "copy: only the backup is there, no temp or test file" bash -c "[[ \$(ls -A '$W/nas/omatalous' | wc -l) = 1 ]]"
  check "copy: the output says how many files went where" grep -q "1 file(s) copied to $W/nas/omatalous" "$W/out"
  check "copy: the local backup stays" bash -c "ls '$CL/backups'/talous-*.db.gz >/dev/null"

  new_world; envfile "BACKUP_COPY_TO=$W/nas/a/b/c" 'BACKUP_AGE_RECIPIENT=age1abc'; mounted "$W/nas"
  bk
  check "copy: encrypted, both files go, no plain file" bash -c "[[ \$(ls -A '$W/nas/a/b/c' | wc -l) = 2 ]] && ls '$W/nas/a/b/c'/talous-*.db.gz.age '$W/nas/a/b/c'/talous-*.app_secret.age >/dev/null && cmp -s '$CL/backups'/talous-*.db.gz.age '$W/nas/a/b/c'/talous-*.db.gz.age"
  check "copy: the copy of the secret is the encrypted one" bash -c "head -1 '$W/nas/a/b/c'/talous-*.app_secret.age | grep -x AGE-ENCRYPTED >/dev/null"

  new_world; envfile "BACKUP_COPY_TO=$W/share"; mounted "$W/share"; mkdir -p "$W/share"
  bk
  check "copy: the target itself is the mount point" bash -c "[[ $RC = 0 ]] && ls '$W/share'/talous-*.db.gz >/dev/null"

  new_world; envfile "BACKUP_COPY_TO=$W/link/omatalous"; mounted "$W/nas"; mkdir -p "$W/nas"; ln -s "$W/nas" "$W/link"
  bk
  check "copy: a symbolic link to a mounted folder is followed" bash -c "[[ $RC = 0 ]] && ls '$W/nas/omatalous'/talous-*.db.gz >/dev/null"

  new_world; envfile "BACKUP_COPY_TO=$W/fromenvfile"; mounted "$W/fromenvfile" "$W/fromshell"
  bk BACKUP_COPY_TO="$W/fromshell"
  check "copy: BACKUP_COPY_TO in the environment wins over .env" bash -c "ls '$W/fromshell'/talous-*.db.gz >/dev/null && [[ ! -e '$W/fromenvfile' ]]"
}

t_copy_refused() {
  new_world; envfile "BACKUP_COPY_TO=$W/nas/omatalous"; : >"$S/mounts"
  bk
  check "not mounted: warns, exits 0, nothing created at the target" bash -c "[[ $RC = 0 && ! -e '$W/nas' ]] && grep -q 'not on a mounted drive' '$W/out'"
  check "not mounted: the local backup stays and passes gzip -t" bash -c "gzip -t '$CL/backups'/talous-*.db.gz"

  new_world; envfile "BACKUP_COPY_TO=$W/nas"; mounted "$W/other"
  bk
  check "not mounted: a mount elsewhere does not count" bash -c "[[ $RC = 0 && ! -e '$W/nas' ]] && grep -q 'not on a mounted drive' '$W/out'"

  new_world; envfile "BACKUP_COPY_TO=$W/nas/afile/sub"; mounted "$W/nas"; mkdir -p "$W/nas"; : >"$W/nas/afile"
  bk
  check "not writable: warns, exits 0, the local backup stays" bash -c "[[ $RC = 0 ]] && grep -q 'not writable' '$W/out' && ls '$CL/backups'/talous-*.db.gz >/dev/null"

  new_world; envfile "BACKUP_COPY_TO=nas/omatalous"; mounted "$W/nas"
  bk
  check "relative: a path that does not start with / is refused with a warning" bash -c "[[ $RC = 0 ]] && grep -q 'full path' '$W/out' && [[ ! -e '$CL/nas' && ! -e '$W/nas' ]]"

  new_world; envfile "BACKUP_COPY_TO=/"; : >"$S/mounts"
  bk
  check "root: / is never a mounted drive, so the whole disk is no target" bash -c "[[ $RC = 0 ]] && grep -q 'not on a mounted drive' '$W/out'"

  new_world; envfile "BACKUP_COPY_TO=$W/nas"; mounted "$W/nas"; mkdir -p "$W/nas"; touch "$S/cpfail"
  bk
  check "full share: warns, exits 0, no cut-short file is left at the target" bash -c "[[ $RC = 0 ]] && grep -q 'could not copy' '$W/out' && [[ -z \$(ls -A '$W/nas') ]]"
  check "full share: the local backup stays" bash -c "gzip -t '$CL/backups'/talous-*.db.gz"
}

# Whoever can write to the share may put links at the names the copy uses. The run's time is fixed, so the names are known.
LINK_STAMP=20261012-030000
LINK_GZ=talous-$LINK_STAMP.db.gz
link_world() { # link_world: a share with a folder, a fixed stamp and a file on the "host" that a link would reach
  new_world; envfile "BACKUP_COPY_TO=$W/nas/omatalous"; mounted "$W/nas"
  echo "$LINK_STAMP" >"$S/stamp"; mkdir -p "$W/nas/omatalous" "$W/host"; echo HOST-FILE >"$W/host/env"
  NAS=$W/nas/omatalous
}
t_copy_links() {
  link_world; ln -s "$W/host/env" "$NAS/.$LINK_GZ.part"
  bk
  check "link at the part name: exit 0 and the copy is reported" bash -c "[[ $RC = 0 ]] && grep -q '1 file(s) copied' '$W/out'"
  check "link at the part name: the file it points to is unchanged" bash -c "[[ \$(cat '$W/host/env') = HOST-FILE ]]"
  check "link at the part name: the copy is a plain file with the backup, no part left" bash -c "[[ -f '$NAS/$LINK_GZ' && ! -L '$NAS/$LINK_GZ' ]] && cmp -s '$CL/backups/$LINK_GZ' '$NAS/$LINK_GZ' && [[ \$(ls -A '$NAS' | wc -l) = 1 ]]"

  link_world; ln -s "$W/host/created" "$NAS/.talous-write-test"
  bk
  check "link at the old write-test name: nothing is created through it" bash -c "[[ ! -e '$W/host/created' ]]"
  check "link at the old write-test name: the copy still works and leaves no test file" bash -c "[[ $RC = 0 ]] && cmp -s '$CL/backups/$LINK_GZ' '$NAS/$LINK_GZ' && ! compgen -G '$NAS/.talous-write-test.*' >/dev/null"

  link_world; ln -s "$W/host/env" "$NAS/$LINK_GZ"
  bk
  check "link at the final name: refused with a warning, exit 0" bash -c "[[ $RC = 0 ]] && grep -q 'talous-$LINK_STAMP.db.gz is a link' '$W/out' && ! grep -q 'file(s) copied' '$W/out'"
  check "link at the final name: the file it points to is unchanged and the link is left" bash -c "[[ \$(cat '$W/host/env') = HOST-FILE && -L '$NAS/$LINK_GZ' ]]"
  check "link at the final name: no part file is left and the local backup stays" bash -c "[[ \$(ls -A '$NAS' | wc -l) = 1 ]] && gzip -t '$CL/backups/$LINK_GZ'"

  link_world; ln -s "$W/hostdir" "$NAS/$LINK_GZ"; mkdir "$W/hostdir"
  bk
  check "link to a folder at the final name: refused, nothing goes into the folder" bash -c "[[ $RC = 0 ]] && grep -q 'is a link' '$W/out' && [[ -z \$(ls -A '$W/hostdir') ]]"

  # without -T cp follows a link to a folder at the part name and leaves the backup inside that folder
  link_world; mkdir "$W/hostdir"; ln -s "$W/hostdir" "$NAS/.$LINK_GZ.part"
  bk
  check "link to a folder at the part name: nothing goes into the folder and the copy is made" bash -c "[[ $RC = 0 ]] && [[ -z \$(ls -A '$W/hostdir') ]] && [[ -f '$NAS/$LINK_GZ' && ! -L '$NAS/$LINK_GZ' ]]"

  # the link appears after the check, between the copy and the rename (cmp plants it)
  link_world; mkdir "$W/hostdir"; echo "$W/hostdir" >"$S/plant-final"
  bk
  check "link planted before the rename: nothing goes into the folder it points to" bash -c "[[ $RC = 0 ]] && [[ -z \$(ls -A '$W/hostdir') ]]"
  check "link planted before the rename: the final name is the plain file with the backup" bash -c "[[ -f '$NAS/$LINK_GZ' && ! -L '$NAS/$LINK_GZ' ]] && cmp -s '$CL/backups/$LINK_GZ' '$NAS/$LINK_GZ' && [[ \$(ls -A '$NAS' | wc -l) = 1 ]]"
}

t_schedule() {
  local line
  new_world
  bk -- --schedule
  check "schedule: exits 0 and does not touch docker" bash -c "[[ $RC = 0 && ! -e '$S/calls.log' ]]"
  check "schedule: one crontab line at 03:30 for this folder, marked with it" bash -c "[[ \$(wc -l <'$S/crontab') = 1 ]] && grep -qxF '30 3 * * * cd $CL && ./scripts/backup.sh >> backups/backup.log 2>&1 # talous-backup:$CL' '$S/crontab'"
  check "schedule: the log folder exists for the first run, for the owner only" test "$(stat -c %a "$CL/backups")" = 700
  check "schedule: says it is not encrypted and where to put the key" bash -c "grep -q 'Encrypted: no' '$W/out' && grep -q 'BACKUP_AGE_RECIPIENT' '$W/out' && grep -q 'BACKUP_COPY_TO' '$W/out'"

  bk -- --schedule 4:05
  check "schedule: a second run replaces the line, it does not add one" bash -c "[[ \$(wc -l <'$S/crontab') = 1 ]] && grep -qxF '5 4 * * * cd $CL && ./scripts/backup.sh >> backups/backup.log 2>&1 # talous-backup:$CL' '$S/crontab'"
  bk -- --schedule 23:59
  check "schedule: 23:59 is accepted" grep -q '^59 23 \* \* \* cd ' "$S/crontab"
  bk -- --schedule 00:00
  check "schedule: 00:00 is accepted" grep -q '^0 0 \* \* \* cd ' "$S/crontab"

  cp "$S/crontab" "$S/crontab.before"
  for line in 24:00 7:5 0730 abc 12:60 '' ; do
    bk -- --schedule "$line"
    # an empty argument means the default time, everything else is refused
    if [[ -z $line ]]; then check "schedule: an empty time is the default" grep -q '^30 3 \* \* \* cd ' "$S/crontab"; cp "$S/crontab" "$S/crontab.before"
    else check "schedule: '$line' is refused and the crontab is left as it was" bash -c "[[ $RC != 0 ]] && cmp -s '$S/crontab' '$S/crontab.before'"; fi
  done
  bk -- --schedule 03:30 extra
  check "schedule: an extra argument is refused" test "$RC" != 0
}

t_schedule_messages() {
  new_world; envfile 'BACKUP_AGE_RECIPIENT=age1secretlookingkey' "BACKUP_COPY_TO=$W/nas"
  bk -- --schedule
  check "messages: .env has both, the output says yes and names the copy folder, never the key" bash -c "grep -q 'Encrypted: yes' '$W/out' && grep -q 'Copied to: $W/nas' '$W/out' && ! grep -q age1secretlookingkey '$W/out'"
  new_world
  bk BACKUP_AGE_RECIPIENT=age1shellonly BACKUP_COPY_TO=/mnt/x -- --schedule
  check "messages: values only in the shell are said not to reach the scheduled run" bash -c "[[ \$(grep -c 'this shell only' '$W/out') = 2 ]] && ! grep -q age1shellonly '$W/out'"
}

t_schedule_other_lines() {
  new_world; second_clone clone2
  printf '0 5 * * 1 echo mine\n# a comment\n' >"$S/crontab"
  bk -- --schedule 02:00
  CLONE_RUN=$CL2 bk -- --schedule 04:00
  check "other lines: the user's lines and both folders' lines are there" bash -c "[[ \$(wc -l <'$S/crontab') = 4 ]] && grep -qx '0 5 \* \* 1 echo mine' '$S/crontab' && grep -qx '# a comment' '$S/crontab' && grep -q '^0 2 .*# talous-backup:$CL\$' '$S/crontab' && grep -q '^0 4 .*# talous-backup:$CL2\$' '$S/crontab'"
  bk -- --schedule 03:15
  check "other lines: scheduling one folder again leaves the other's line (a name that starts the same too)" bash -c "[[ \$(wc -l <'$S/crontab') = 4 ]] && grep -q '^15 3 .*# talous-backup:$CL\$' '$S/crontab' && grep -q '^0 4 .*# talous-backup:$CL2\$' '$S/crontab'"
  bk -- --unschedule
  check "unschedule: removes this folder's line only" bash -c "[[ $RC = 0 && \$(wc -l <'$S/crontab') = 3 ]] && ! grep -q 'talous-backup:$CL\$' '$S/crontab' && grep -q 'talous-backup:$CL2\$' '$S/crontab' && grep -qx '0 5 \* \* 1 echo mine' '$S/crontab'"
  bk -- --unschedule
  check "unschedule: a second time says there was none and changes nothing" bash -c "[[ $RC = 0 && \$(wc -l <'$S/crontab') = 3 ]] && grep -q 'No daily backup is scheduled' '$W/out'"
  CLONE_RUN=$CL2 bk -- --unschedule
  check "unschedule: the user's own lines stay when the last backup line goes" bash -c "[[ \$(wc -l <'$S/crontab') = 2 ]] && grep -qx '0 5 \* \* 1 echo mine' '$S/crontab'"
  rm -f "$S/crontab"
  bk -- --schedule
  bk -- --unschedule
  check "unschedule: nothing else in the crontab, so the crontab is removed" test ! -e "$S/crontab"
  CLONE_RUN=
}

t_schedule_refused() {
  new_world
  PATHX=$T/bin:$T/agebin:$SYS
  bk -- --schedule
  check "no cron: refused with the way to get it, nothing else done" bash -c "[[ $RC != 0 ]] && grep -q 'crontab is missing' '$W/out' && [[ ! -e '$S/calls.log' ]]"
  PATHX=$PATH_FULL
  printf '0 5 * * 1 echo mine\n' >"$S/crontab"; touch "$S/croncorrupt"
  bk -- --schedule
  check "unreadable crontab: refused, and not replaced by a crontab of one line" bash -c "[[ $RC != 0 ]] && grep -q 'could not read the crontab' '$W/out' && [[ \$(cat '$S/crontab') = '0 5 * * 1 echo mine' ]] && ! grep -q 'crontab -\$' '$S/cron-calls.log'"
  rm -f "$S/croncorrupt"

  W=$(mktemp -d -p "$T"); S=$W/stub; mkdir -p "$S" "$W/home" "$W/with space/clone/scripts/lib"
  cp "$SRC/scripts/backup.sh" "$W/with space/clone/scripts/"; cp "$SRC/scripts/lib/dbcopy.sh" "$W/with space/clone/scripts/lib/"
  CL=$W/with\ space/clone
  bk -- --schedule
  check "folder with a space: refused, the crontab is not written" bash -c "[[ $RC != 0 ]] && grep -q 'characters a crontab line does not allow' '$W/out' && [[ ! -e '$S/crontab' ]]"

  new_world
  bk -- --nonsense
  check "usage: an unknown argument is refused and nothing runs" bash -c "[[ $RC != 0 ]] && grep -q 'usage' '$W/out' && [[ ! -e '$S/calls.log' ]]"
  bk -- --help
  check "usage: --help prints the usage and exits 0" bash -c "[[ $RC = 0 ]] && grep -q 'usage' '$W/out'"
}

t_cron_line_runs() {
  local line cmd
  new_world; envfile 'BACKUP_AGE_RECIPIENT=age1abc' "BACKUP_COPY_TO=$W/nas/omatalous"; mounted "$W/nas"
  bk -- --schedule 03:30
  line=$(grep 'talous-backup:' "$S/crontab")
  cmd=$(sed -E 's/^([^ ]+ ){5}//; s/ # talous-backup:.*$//' <<<"$line")
  (cd "$W/home" && env -i PATH="$PATHX" HOME="$W/home" STUB="$S" /bin/sh -c "$cmd")
  check "cron line: runs as cron runs it, encrypted, copied, and logged in backups/backup.log" bash -c "ls '$CL/backups'/talous-*.db.gz.age '$CL/backups'/talous-*.app_secret.age '$W/nas/omatalous'/talous-*.db.gz.age '$W/nas/omatalous'/talous-*.app_secret.age >/dev/null && grep -q 'encrypted' '$CL/backups/backup.log' && grep -q 'copied to $W/nas/omatalous' '$CL/backups/backup.log'"
}

t_doctor_hint() {
  check "doctor: both backup hints name --schedule, in English and Finnish" test "$(grep -c 'backup.sh --schedule' "$SRC/scripts/doctor.sh")" = 2
  check "doctor: the old 'schedule it' hint is gone" bash -c "! grep -q 'and schedule it\|ja ajasta se:' '$SRC/scripts/doctor.sh'"
}

for t in plain env_file env_file_forms age_missing not_running copy copy_refused copy_links schedule schedule_messages schedule_other_lines schedule_refused cron_line_runs doctor_hint; do
  want "$t" && "t_$t"
done

echo; echo "$PASS passed, $FAILED failed"
((FAILED == 0))
