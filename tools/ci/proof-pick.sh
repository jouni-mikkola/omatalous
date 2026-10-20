# shellcheck shell=bash disable=SC2154,SC2034
# The choice of baselines of tools/ci/local-proof.sh, sourced by it: which refs of the list a proof runs ("Which baselines" in
# the header there). It defines functions and variables and runs nothing; it reads ALL, SHA, PATHS, NOT_RUN and LEG_ONLY
# of local-proof.sh when they are called.
# movable REF: the docker-compose.yml of the baseline reads the keys of a port and a name, so its rehearsal can run
# in another lane than 0 (upgrade-run.sh refuses the keys otherwise). Asked of the commit under proof's repository.
movable() {
  local c
  c=$(git show "$1:docker-compose.yml" 2>/dev/null) || return 1
  [[ $c == *"\${HOST_PORT"* && $c == *"\${INSTANCE_NAME"* ]]
}


# update_path REF: what an update from REF runs through, as one hash (see "Which baselines"); none (return 1) for no commit.
update_path() {
  {
    git ls-tree "$1" -- apps/server/migrations scripts Dockerfile \
      && git ls-tree "$1" | awk -F'\t' '$2 ~ /^docker-compose.*\.yml$/'
  } 2>/dev/null | git hash-object --stdin
}

# collapse REFS...: the refs that prove every update path of them, into PICK, and how many paths there are into PATHS_SAID.
# The newest of each path runs, the oldest and newest ref, the oldest that can move (the drills' install) and every one that
# cannot (lane 0 runs those one at a time). A ref with no readable path is a path of its own.
collapse() {
  local -a refs=("$@") keys=(); local -A last=()
  local i k n=$# movable_seen=0 paths=0 keep
  for i in "${!refs[@]}"; do
    k=$(update_path "${refs[i]}") || k="unreadable ${refs[i]}"
    keys+=("$k"); last["$k"]=$i
  done
  PICK=()
  for i in "${!refs[@]}"; do
    keep=0
    [[ ${last["${keys[i]}"]} != "$i" ]] || { keep=1; paths=$((paths + 1)); }
    ((i == 0 || i == n - 1)) && keep=1
    if ! movable "${refs[i]}"; then keep=1
    elif ((!movable_seen)); then keep=1; movable_seen=1; fi
    ((!keep)) || PICK+=("${refs[i]}")
  done
  PATHS_SAID="the $n baselines of the list are $paths update paths, and the newest of each runs"
}

# pick_baselines TEXT: the baselines this proof runs, into PICK in the order of the list, and why into WHY. The one
# place for the rule in the header.
PICK=()
ALLREFS=() # every ref of the list, picked or not
WHY=''
pick_baselines() {
  local refs=() marked='' above='' l last changed i n f spec=("${PATHS[@]}")
  for f in "${NOT_RUN[@]}" "${LEG_ONLY[@]}"; do spec+=(":(exclude)$f"); done
  while IFS= read -r l; do
    l=${l#"${l%%[![:space:]]*}"}
    l=${l%"${l##*[![:space:]]}"}
    case $l in
      '') ;;
      '#'*) above=$l ;;
      *)
        [[ " ${refs[*]:-} " == *" $l "* ]] || refs+=("$l")
        [[ $above != *"first public release"* ]] || marked=$l
        above='' ;;
    esac
  done <<<"$1"
  n=${#refs[@]}
  ((n)) || return 1
  ALLREFS=("${refs[@]}")
  last=${refs[n - 1]}
  if ((ALL)); then PICK=("${refs[@]}"); WHY="--all: every baseline of the list runs, none is left out"; return 0; fi
  # a last ref that is no commit here cannot say that nothing changed
  if ! changed=$(git diff --name-only "$last" "$SHA" -- "${spec[@]}" 2>/dev/null); then
    collapse "${refs[@]}"; WHY="no diff from $last, the last of the list, could be read; $PATHS_SAID"; return 0
  fi
  if [[ -n $changed ]]; then collapse "${refs[@]}"; WHY="${changed%%$'\n'*} changed since $last; $PATHS_SAID"; return 0; fi
  for i in "${!refs[@]}"; do
    if ((i == 0 || i >= n - 3)) || [[ ${refs[i]} == "$marked" ]]; then PICK+=("${refs[i]}"); fi
  done
  WHY="nothing an update runs through changed since $last"
}
