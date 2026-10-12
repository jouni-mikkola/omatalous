# shellcheck shell=bash
# Who holds a lock: the process behind a pid. Sourced by tools/slots.sh (a slot's owner) and by the lead's landing queue
# (its pid file), so both mean the same by "the owner is gone". It defines functions only.

start_of() { # the start time of a process, so a reused pid is not taken for its old owner
  local s
  if [[ -r /proc/$1/stat ]]; then s=$(</proc/$1/stat) && s=${s##*) } && set -- $s && echo "${20:-}"; else ps -o lstart= -p "$1" 2>/dev/null | tr -s ' '; fi
}

alive() { # a zombie that nobody has waited for yet is gone
  local s
  if [[ -r /proc/$1/stat ]]; then s=$(</proc/$1/stat) 2>/dev/null && s=${s##*) } && [[ ${s%% *} != Z ]]; else kill -0 "$1" 2>/dev/null; fi
}

old() { [[ -n $(find "$1" -maxdepth 0 -mmin +1 2>/dev/null) ]]; } # older than a minute (a claim that never wrote its owner)

owner_gone() { # owner_gone PID START: true when no such process runs, or the pid now belongs to another process
  local cur
  [[ ${1:-} =~ ^[0-9]+$ ]] || return 0
  alive "$1" || return 0
  cur=$(start_of "$1")
  [[ -z ${2:-} || -z $cur || $2 == "$cur" ]] || return 0
  return 1
}
