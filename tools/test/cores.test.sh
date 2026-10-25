#!/usr/bin/env bash
# Tests for tools/cores.sh: the share of the cores a heavy run may use, by the leases that are taken. Leases live in a
# throwaway folder (the git common dir of a throwaway repository), so the real runs are not affected.
#
#   tools/test/cores.test.sh [name-filter]
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
SRC=$(cd "$HERE/../.." && pwd)
# a suite that a run with a lease runs inherits its share: none may reach the scenarios
# shellcheck source=cut-env.sh
. "$HERE/cut-env.sh"
unset CORES_HELD CI CHECK_CORES CHECK_CORE_SLOTS
FILTER=${1:-}
PASS=0; FAILED=0
pass() { PASS=$((PASS + 1)); echo "ok   $1"; }
fail() { FAILED=$((FAILED + 1)); echo "FAIL $1"; [[ -z ${2:-} ]] || echo "       $2"; }
check() { local n=$1; shift; if "$@"; then pass "$n"; else fail "$n"; fi; }
want() { [[ -z $FILTER || $1 == *$FILTER* ]]; }

TMP=$(mktemp -d)
HOLDERS=()
cleanup() { local p; for p in ${HOLDERS[@]+"${HOLDERS[@]}"}; do kill "$p" 2>/dev/null; done; rm -rf "$TMP"; }
trap cleanup EXIT
export SLOTS_LOG=$TMP/slots.log CHECK_SLOT_POLL=0.1

# a repository of its own: its git common dir holds the leases and the settings file
R=$TMP/repo
mkdir -p "$R/tools"
git init -q "$R"
cp "$SRC/tools/cores.sh" "$SRC/tools/slots.sh" "$R/tools/"
mkdir -p "$R/tools/lib"; cp "$SRC/tools/lib/owner.sh" "$SRC/tools/lib/cores.mjs" "$R/tools/lib/"
cores() { (cd "$R" && bash tools/cores.sh "$@"); }
slot_dirs() { find "$R/.git/cores-slots" -maxdepth 1 -name 'slot-*' 2>/dev/null | wc -l; }

# hold: start a --hold in the background; its share lands in $HOLD_OUT, its stdin is a fifo whose writer is fd 50+N
# (closing it ends the holder, as the end of a node process does)
n=0 total=0
hold() { # hold [ENV=value...]
  local i; n=$((n + 1)) total=$((total + 1)); HOLD_OUT=$TMP/hold-$total
  mkfifo "$TMP/in-$total"
  # the holder must not keep the write ends of the earlier holders' fifos open, or closing them here would not end them
  (cd "$R" && for ((i = 51; i < 50 + n; i++)); do eval "exec $i>&-"; done; exec env "$@" bash tools/cores.sh --hold --label t <"$TMP/in-$total" >"$HOLD_OUT" 2>"$TMP/err-$total") &
  HOLDERS+=($!)
  eval "exec $((50 + n))>\"$TMP/in-$total\""
}
end_hold() { eval "exec $((50 + $1))>&-"; } # end_hold N: the Nth holder's stdin ends
end_all() { local i; for ((i = 1; i <= n; i++)); do end_hold "$i"; done; wait; HOLDERS=(); }
wait_for() { local i; for ((i = 0; i < 100; i++)); do [[ -s $1 ]] && return 0; sleep 0.1; done; return 1; }

t_share_math() {
  check "share: 12 CPUs, 2 leases: the first run takes all, the second half" test "$(CHECK_CORES=12 cores --share)" = "cores=12 leases=2 first=12 others=6"
  check "share: the default is one lease per 6 CPUs" test "$(CHECK_CORES=28 cores --share)" = "cores=28 leases=4 first=28 others=4"
  check "share: CHECK_CORE_SLOTS sets the leases, and the others share half the cores" test "$(CHECK_CORES=12 CHECK_CORE_SLOTS=3 cores --share)" = "cores=12 leases=3 first=12 others=3"
  check "share: a small machine is one lease of all of it" test "$(CHECK_CORES=4 cores --share)" = "cores=4 leases=1 first=4 others=4"
  check "share: never under one core" test "$(CHECK_CORES=2 CHECK_CORE_SLOTS=9 cores --share)" = "cores=2 leases=2 first=2 others=1"
}

t_settings_file() {
  printf '%s\n' "CHECK_CORES=16" "CHECK_CORE_SLOTS=4" "OTHER=9" "CHECK_CORES=x" >"$R/.git/check-cores.conf"
  check "conf: the file sets the cores and the leases, and takes nothing else" test "$(cores --share)" = "cores=16 leases=4 first=16 others=2"
  check "conf: the environment wins over the file" test "$(CHECK_CORES=8 cores --share)" = "cores=8 leases=4 first=8 others=1"
  rm -f "$R/.git/check-cores.conf"
}

t_run_sees_its_share() {
  check "run: the command sees CORES_SHARE and CORES_HELD" test "$(CHECK_CORES=12 cores -- bash -c 'echo $CORES_SHARE $CORES_HELD')" = "12 1"
  check "run: its exit code is the command's" bash -c "cd '$R' && CHECK_CORES=12 bash tools/cores.sh -- bash -c 'exit 7'; test \$? = 7"
  check "run: the lease is given back" test "$(slot_dirs)" = 0
  check "run: inside a run nothing more is taken and the share is the one handed down" test "$(CHECK_CORES=12 cores -- bash tools/cores.sh -- bash -c 'echo $CORES_SHARE; find .git/cores-slots -name "slot-*" | wc -l' | tr '\n' ' ')" = "12 1 "
  check "run: under CI, the machine is the run's" test "$(CI=1 CHECK_CORES=12 cores -- bash -c 'echo $CORES_SHARE; find .git/cores-slots -name "slot-*" 2>/dev/null | wc -l' | tr '\n' ' ')" = "12 0 "
  check "run: with CHECK_CORE_SLOTS=0 there is no limit and no lease" test "$(CHECK_CORE_SLOTS=0 CHECK_CORES=12 cores -- bash -c 'echo $CORES_SHARE; find .git/cores-slots -name "slot-*" 2>/dev/null | wc -l' | tr '\n' ' ')" = "12 0 "
}

t_leases_by_the_crowd() {
  local a b c
  hold CHECK_CORES=12; a=$HOLD_OUT; wait_for "$a"
  check "hold: a run on a quiet machine gets all the cores" test "$(<"$a")" = 12
  hold CHECK_CORES=12; b=$HOLD_OUT; wait_for "$b"
  check "hold: the second gets the half that is left to the others" test "$(<"$b")" = 6
  check "hold: two leases are taken" test "$(slot_dirs)" = 2
  hold CHECK_CORES=12; c=$HOLD_OUT; sleep 1
  check "hold: a third waits, and says so" bash -c "[[ ! -s '$c' ]] && grep -q 'all 2 slots are taken' '$TMP/err-$total'"
  end_hold 1
  wait_for "$c"
  check "hold: a lease given back lets the third in" test -s "$c"
  end_all
  check "hold: every lease is given back when its holder's stdin ends" test "$(slot_dirs)" = 0
}

t_a_killed_holder_frees_its_lease() {
  local o
  hold CHECK_CORES=4 CHECK_CORE_SLOTS=1; o=$HOLD_OUT; wait_for "$o"
  check "kill: one lease is taken" test "$(slot_dirs)" = 1
  { kill -KILL "${HOLDERS[0]}"; wait "${HOLDERS[0]}"; } 2>/dev/null
  check "kill: a lease whose holder was killed is taken over by the next" test "$(CHECK_CORES=4 CHECK_CORE_SLOTS=1 CHECK_SLOT_WAIT=20 cores -- bash -c 'echo $CORES_SHARE')" = 4
  end_all
}

t_a_run_that_waited_out_the_leases_takes_the_small_share() {
  local o
  hold CHECK_CORES=12; o=$HOLD_OUT; wait_for "$o"
  hold CHECK_CORES=12; o=$HOLD_OUT; wait_for "$o"
  # a stuck holder must not turn the next run into a whole-machine run: it goes on without a lease, but on the share of a crowd
  check "wait: a run that gave up waiting takes the share of the others, not all the cores" test "$(CHECK_CORES=12 CHECK_SLOT_WAIT=1 cores -- bash -c 'echo $CORES_SHARE' 2>/dev/null)" = 6
  end_all
}

for t in $(declare -F | awk '{print $3}' | grep '^t_'); do
  want "$t" || continue
  rm -rf "$R/.git/cores-slots"
  "$t"
  end_all 2>/dev/null; n=0
done
echo "$PASS passed, $FAILED failed"
((FAILED == 0))
