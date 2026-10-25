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

sh_run() {
  local give=$1 jobs=$2 self=$3 xp raised=0 i c
  shift 3
  printf '%s\n' "$@" >"$CHECK_LOG/sh-list"
  ( trap - INT QUIT EXIT; exec xargs -P "$jobs" -L1 -a "$CHECK_LOG/sh-list" bash "$self" __job </dev/null ) &
  xp=$!
  while kill -0 "$xp" 2>/dev/null; do
    # not before the subshell has become xargs: a USR1 that finds the shell ends it
    if ((give > 0 && !raised)) && [[ -e $CHECK_LOG/done-tests ]] && read -r c <"/proc/$xp/comm" 2>/dev/null && [[ $c == xargs ]]; then
      raised=1
      for ((i = 0; i < give; i++)); do kill -USR1 "$xp" 2>/dev/null; sleep 0.1; done # apart: signals sent at once count as one
    fi
    sleep "${CHECK_NAP:-0.5}"
  done
  wait "$xp" 2>/dev/null
}

# jobs_split: the CPUs of this run and the shell jobs at a time. With a lease on a share of the cores (CORES_SHARE, tools/cores.sh)
# that share is the CPUs and the jobs take half of it, else the CPUs of the machine and, over 12 of them, those less 8 (at least 4).
# floor: the least the vitest workers get beside the jobs.
jobs_split() {
  cpus=${CORES_SHARE:-$(nproc 2>/dev/null || getconf _NPROCESSORS_ONLN 2>/dev/null || echo 4)}
  # shellcheck disable=SC2034 # leased, floor and JOBS are read by tools/check.sh, which sources this file
  if [[ -n ${CORES_SHARE:-} ]]; then leased=1 floor=1 JOBS=${CHECK_JOBS:-$((cpus / 2 > 1 ? cpus / 2 : 1))}
  else leased=0 floor=2 JOBS=${CHECK_JOBS:-$((cpus > 12 ? cpus - 8 : 4))}; fi
}
