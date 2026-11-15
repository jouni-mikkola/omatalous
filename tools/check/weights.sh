#!/usr/bin/env bash
# The order and the running of the shell jobs of tools/check.sh (sourced by it, not run).
#   sh_order JOB...        ORDERED: the jobs, the longest first. A job is "suite scenario"; its weight is the CPU
#                          milliseconds the last green run of it took (a job with no record counts as the longest, and
#                          equal weights keep the order given). Started longest first, no job is left to run alone at the end.
#   sh_run GIVE JOBS SELF LINE...  runs the numbered LINEs ("id suite scenario") JOBS at a time with `bash SELF __job`.
#                          When the tests step is done (CHECK_LOG/done-tests), GIVE more run at once: the cores the vitest
#                          workers held. xargs takes SIGUSR1 as "one more job at a time". CHECK_NAP is the seconds
#                          between two looks.
#   weights_read ARRAY / weights_write ARRAY: the weights, "job<TAB>ms" lines in $CHECK_WEIGHTS_FILE or check-weights
#                          beside the stamps, shared by the worktrees. They only order; a missing or damaged file orders nothing.
weights_file() { echo "${CHECK_WEIGHTS_FILE:-$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null)/check-weights}"; }
# weights_read ARRAY: the recorded weights into the associative ARRAY
weights_read() {
  local -n out=$1
  local f k v
  f=$(weights_file)
  [[ -r $f ]] || return 0
  # shellcheck disable=SC2034 # out is a nameref: the caller's array
  while IFS=$'\t' read -r k v; do [[ $v =~ ^[0-9]+$ ]] && out[$k]=$v; done <"$f"
  return 0
}
# weights_write ARRAY: the weights of this run laid over the recorded ones (the file is replaced whole, so a second check
# writing at the same time loses nothing but its own lines)
weights_write() {
  local -n fresh=$1
  local f k tmp
  local -A all=()
  ((${#fresh[@]})) || return 0
  f=$(weights_file)
  [[ $f == /* ]] || return 0
  weights_read all
  for k in "${!fresh[@]}"; do all[$k]=${fresh[$k]}; done
  tmp=$f.$$
  for k in "${!all[@]}"; do printf '%s\t%s\n' "$k" "${all[$k]}"; done | LC_ALL=C sort >"$tmp" 2>/dev/null && mv -f "$tmp" "$f" 2>/dev/null || rm -f "$tmp"
  return 0
}


sh_order() {
  local -A cost=()
  local line
  weights_read cost
  ORDERED=()
  (($#)) || return 0
  # shellcheck disable=SC2034 # read by tools/check.sh, which sources this file
  mapfile -t ORDERED < <(for line in "$@"; do printf '%s\t%s\n' "${cost[$line]:-999999999}" "$line"; done | LC_ALL=C sort -s -t $'\t' -k1,1nr | cut -f2)
}

# usr1_in FIELD PID: whether USR1 (signal 10) is in the mask FIELD of the process (/proc/PID/status). SigCgt: it handles
# the signal; ShdPnd: one was sent and it has not taken it yet.
usr1_in() {
  local k v
  while read -r k v; do
    [[ $k == "$1:" ]] || continue
    (((16#$v >> 9) & 1))
    return
  done 2>/dev/null <"/proc/$2/status"
  return 1
}

sh_run() {
  local give=$1 jobs=$2 self=$3 xp raised=0 i w c
  shift 3
  printf '%s\n' "$@" >"$CHECK_LOG/sh-list"
  ( trap - INT QUIT EXIT; exec xargs -P "$jobs" -L1 -a "$CHECK_LOG/sh-list" bash "$self" __job </dev/null ) &
  xp=$!
  while kill -0 "$xp" 2>/dev/null; do
    # not before the subshell has become xargs and xargs handles USR1: one that finds the shell, or an xargs that has only
    # just started, ends it. Both are asked: a shell with an EXIT trap catches USR1 too, to end by it.
    if ((give > 0 && !raised)) && [[ -e $CHECK_LOG/done-tests ]] && read -r c <"/proc/$xp/comm" 2>/dev/null && [[ $c == xargs ]] && usr1_in SigCgt "$xp"; then
      raised=1
      # one at a time: signals sent before the first is taken count as one, however long a busy machine keeps xargs waiting
      for ((i = 0; i < give; i++)); do
        kill -USR1 "$xp" 2>/dev/null
        for ((w = 0; w < 500; w++)); do usr1_in ShdPnd "$xp" || break; sleep 0.01; done
      done
    fi
    sleep "${CHECK_NAP:-0.5}"
  done
  wait "$xp" 2>/dev/null
}

# jobs_split: the CPUs of this run and the shell jobs at a time: the CPUs of the machine and, over 12 of them, those less 8 (at least 4).
# floor: the least the vitest workers get beside the jobs.
jobs_split() {
  cpus=$(nproc 2>/dev/null || getconf _NPROCESSORS_ONLN 2>/dev/null || echo 4)
  # shellcheck disable=SC2034 # floor and JOBS are read by tools/check.sh, which sources this file
  floor=2 JOBS=${CHECK_JOBS:-$((cpus > 12 ? cpus - 8 : 4))}
}
