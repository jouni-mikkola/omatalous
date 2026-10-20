# shellcheck shell=bash
# The writer of .env for the maintenance helper (scripts/ops-helper.sh loads this file in load_libs, from its own
# folder) and for the Cloudflare setup of the installer (scripts/lib/cloudflare.sh loads it from the folder it is in);
# scripts/install.sh still writes the first .env itself. It defines functions and runs nothing.
#
# Decision it serves: .env is what the app starts with, the tunnel token included, and four jobs change it (remote
# access from the page, a new home network address, the switch for new versions, the installer's Cloudflare setup).
# They all change it here, so a stop at any line (a kill, a power cut, a full disk) leaves the old file or the new one,
# never a half, and a fix to the writing reaches every one of them.
#
#   envfile_write FILE WHERE MODE ITEM...   envfile_stage, then envfile_commit
#   envfile_stage FILE WHERE ITEM...        FILE.new becomes the new file, whole. FILE is not touched
#   envfile_commit FILE MODE                FILE.new takes the place of FILE, in one rename
#   envfile_restore FILE FROM               FILE becomes a copy of the file FROM, this user's alone, the same way
#   envfile_new FILE                        FILE.new made empty with mode 600, never through a link
# Each returns 1 when the write could not be made. FILE is then as it was, and the FILE.new it made is gone.
#
# ITEM    KEY=value   KEY is set to value
#         KEY         every line of KEY goes
#         +KEY        KEY is kept as the file has it
# WHERE   place   a key that is set keeps its place: its last line is replaced where it stands and earlier lines of it
#                 go. A key the file does not have becomes a new last line. A kept key is left as it stands
#         end     every line of every key named goes from where it stands, and the set and the kept ones follow the
#                 other lines in the order given, each once (a kept key as its last line; one the file does not have
#                 is not written)
# MODE    same    the new file gets the owner, the group and the mode of FILE
#         600     the new file is this user's alone
#
# Every line of a key that is not named stays byte for byte, and a last line without a newline gets one only when a
# line is added after it. A file that would not change, with the mode it should have, is not written again.
# The values meet bash builtins only: printf writes them, and no value is an argument of another program, where `ps`
# would show it. Key names and line numbers are. The lines that stay are copied by sed, which is told line numbers.

# FILE.new made empty with mode 600, right after the caller removed an old one. noclobber: a regular file, or a link to
# one or to nothing, that appeared in between is not written through (another kind of file, a device behind a link, is:
# bash refuses only those).
envfile_new() { (set -C; : >"$1.new") 2>/dev/null && chmod 600 "$1.new"; }

# the newline that the last line of FILE lacks, on stdout (nothing for an empty file or a whole last line)
envfile_nl() { [[ ! -s $1 || $(tail -c 1 "$1" | wc -l) -eq 1 ]] || echo; }

envfile_stage() { # envfile_stage FILE WHERE ITEM...
  local file=$1 where=$2 item key nums n last i=0 gone="" from=1 open=0 bad=0
  # at[LINE] is the number of the item that line becomes. after holds what follows the other lines: the number of an
  # item, or L and the number of a line of FILE. An item is only ever named by its number, so that its value is in no
  # variable of this function but `item`.
  local -a at=() after=()
  shift 2
  [[ $where == place || $where == end ]] || return 1
  [[ -f $file ]] && rm -f "$file.new" 2>/dev/null && envfile_new "$file" || return 1
  # the number of a last line that has no newline (0 when the file ends with one, or is empty)
  [[ ! -s $file || $(tail -c 1 "$file" | wc -l) -eq 1 ]] || open=$(($(wc -l <"$file") + 1))
  for item in "$@"; do
    i=$((i + 1)); key=${item#+}; key=${key%%=*}
    # a key is a name and nothing else: it goes into a pattern and on grep's command line
    [[ $key =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || { rm -f "$file.new"; return 1; }
    if [[ $where != end && $item == +* ]]; then continue; fi
    nums=$(LC_ALL=C grep -an "^$key=" "$file" | cut -d: -f1 | tr '\n' ' ') || true
    last=${nums% }; last=${last##* }
    for n in $nums; do
      if [[ $where != end && $item == *=* && $n == "$last" ]]; then at[n]=$i; else gone+="${n}d;"; fi
    done
    if [[ $item == +* ]]; then [[ -z $last ]] || after+=("L$last")
    elif [[ $item == *=* ]] && [[ $where == end || -z $last ]]; then after+=("$i"); fi
  done
  {
    if ((${#at[@]})); then
      for n in "${!at[@]}"; do
        if ((from < n)); then LC_ALL=C sed -n "${from},$((n - 1)){${gone}p}" "$file" || bad=1; fi
        i=${at[n]}; from=$((n + 1))
        if ((n == open)); then printf '%s' "${!i}" || bad=1; else printf '%s\n' "${!i}" || bad=1; fi
      done
    fi
    LC_ALL=C sed -n "${from},\${${gone}p}" "$file" || bad=1
    if ((${#after[@]})); then
      for n in "${after[@]}"; do
        envfile_nl "$file.new"
        if [[ $n == L* ]]; then LC_ALL=C sed -n "${n#L}p" "$file" || bad=1; else printf '%s\n' "${!n}" || bad=1; fi
      done
      envfile_nl "$file.new"
    fi
  } >>"$file.new" || bad=1
  if ((bad)); then rm -f "$file.new"; return 1; fi
  return 0
}

envfile_commit() { # envfile_commit FILE MODE
  local file=$1 rc=1
  if [[ $2 != same && $2 != 600 ]]; then rc=1
  elif cmp -s "$file" "$file.new" && [[ $2 == same || $(stat -c %a "$file" 2>/dev/null) == 600 ]]; then rc=0
  elif [[ $2 == 600 ]] || { chown --reference="$file" "$file.new" && chmod --reference="$file" "$file.new"; } 2>/dev/null; then
    # the new file is on the disk before it gets the name: a power cut after the rename finds all of it
    sync "$file.new" 2>/dev/null || true
    if mv -f "$file.new" "$file"; then rc=0; fi
  fi
  rm -f "$file.new" 2>/dev/null
  return "$rc"
}

envfile_write() { # envfile_write FILE WHERE MODE ITEM...
  local file=$1 where=$2 mode=$3
  shift 3
  envfile_stage "$file" "$where" "$@" && envfile_commit "$file" "$mode"
}

envfile_restore() { # envfile_restore FILE FROM
  if rm -f "$1.new" 2>/dev/null && envfile_new "$1" && cat "$2" >>"$1.new"; then envfile_commit "$1" 600; else rm -f "$1.new" 2>/dev/null; return 1; fi
}
