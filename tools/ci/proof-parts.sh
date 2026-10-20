# shellcheck shell=bash
# shellcheck disable=SC2034 # DO_IMAGE, DO_SIG, DO_DRILLS, RUN_REFS and the like are read by local-proof.sh, which sources this file
# The parts of the local proof (tools/ci/local-proof.sh --part, --lane and --farm): functions only.
#
# Parts, for the farm of a release: image+smoke (the image and the smoke test), signature, drills (the rehearsal from
# the newest baseline, which leaves its install up, and every drill) and lane:K/N (the K-th share of the other rehearsals: the
# picked baselines but the newest, the i-th of them, from 0, in share i mod N + 1, so that N shares hold each once). A part
# writes no stamp and says "passed" in its last line. --farm reads the records of this commit from origin (farm_check of
# tools/ci/farm-lib.sh: this leg, this commit, the command this checkout runs, exit 0), runs the parts that have none here,
# and stamps the commit when they pass. Its lanes are the N with the most green records; the others of that N run here.
#

# part_is PART: the part, or a refusal
part_is() {
  case $1 in
    image+smoke | signature | drills) ;;
    lane:*) [[ ${1#lane:} =~ ^([1-9][0-9]?)/([1-9][0-9]?)$ ]] && ((BASH_REMATCH[1] <= BASH_REMATCH[2])) || refuse "--lane needs K/N with 1 <= K <= N <= 99, like 2/4." ;;
    *) refuse "--part is one of image+smoke, signature, drills, lane:K/N." ;;
  esac
  [[ -z $PART ]] || refuse "Give one part."
  PART=$1
}

# choose_parts: the parts this run proves, from PART or FARM and the picked baselines: DO_IMAGE, DO_SIG, DO_DRILLS (1 or 0),
# RUN_REFS (the rehearsals, the newest last when the drills run here) and FROM_RECORDS (the parts a record covers)
choose_parts() {
  local k n g best
  # The parts this run proves (see "Parts"). OTHERS: the rehearsals the lanes share, every picked baseline but the newest.
  NEWEST=${PICK[${#PICK[@]} - 1]}
  OTHERS=("${PICK[@]:0:${#PICK[@]}-1}")
  DO_IMAGE=1 DO_SIG=1 DO_DRILLS=1
  declare -gA SHARE=() # the shares of the lanes this run rehearses, by K (all of them: no entry needed)
  SHARES=0            # N of the lanes, 0: no split
  share_refs() { # the refs of OTHERS in the shares of SHARE (all with SHARES 0), in their order
    local i
    for i in "${!OTHERS[@]}"; do ((SHARES == 0)) || [[ -n ${SHARE[$((i % SHARES + 1))]:-} ]] && echo "${OTHERS[i]}"; done
  }
  FROM_RECORDS=() # with --farm: the parts that a record covers, with its host
  if [[ -n $PART ]]; then
    DO_IMAGE=0 DO_SIG=0 DO_DRILLS=0 SHARES=1
    case $PART in
      image+smoke) DO_IMAGE=1 ;;
      signature) DO_SIG=1 ;;
      drills) DO_DRILLS=1 ;;
      lane:*) k=${PART#lane:}; SHARES=${k#*/}; SHARE[${k%/*}]=1 ;;
    esac
  elif ((FARM)); then
    # shellcheck source=farm-lib.sh
    . "$ROOT/tools/ci/farm-lib.sh" || exit 2
    FARM_LIST=$LIST # a record of a proof from another list is not one of this proof
    farm_fetch "$SHA" || echo "local proof: $FARM_REMOTE does not answer, so the records fetched before are all there is"
    took() { FROM_RECORDS+=("$1 ($FARM_HOST)"); }
    ! farm_check "$SHA" proof:image+smoke || { DO_IMAGE=0; took image+smoke; }
    ! farm_check "$SHA" proof:signature || { DO_SIG=0; took signature; }
    ! farm_check "$SHA" proof:drills || { DO_DRILLS=0; took drills; }
    # the lanes: the N with the most green records; the shares of that N without one run here
    best=0
    for n in $(farm_legs "$SHA" | sed -n 's|^proof:lane:[0-9]*/\([0-9]*\)$|\1|p' | sort -un); do
      g=0
      for ((k = 1; k <= n; k++)); do ! farm_check "$SHA" "proof:lane:$k/$n" || g=$((g + 1)); done
      ((g <= best)) || { best=$g; SHARES=$n; }
    done
    if ((SHARES)); then
      for ((k = 1; k <= SHARES; k++)); do
        if farm_check "$SHA" "proof:lane:$k/$SHARES"; then took "lane:$k/$SHARES"; else SHARE[$k]=1; fi
      done
    fi
  fi
  mapfile -t RUN_REFS < <(share_refs)
  ((DO_DRILLS == 0)) || RUN_REFS+=("$NEWEST")
}

# first_line: the line that opens a proof, its parts named
first_line() {
  if [[ -n $PART ]]; then
    echo "local proof of $SHORT, part $PART of ${#PICK[@]} baselines ($WHY): $LEGS legs${RUN_REFS[*]:+ (rehearsals from ${RUN_REFS[*]})}, $JOBS at a time. Logs: $LOGS"
  elif ((FARM)); then
    echo "local proof of $SHORT: ${#PICK[@]} baselines ($WHY), $JOBS at a time. From the farm's records: ${FROM_RECORDS[*]:-none}. Here: $LEGS legs. Logs: $LOGS"
  else
    echo "local proof of $SHORT: ${#PICK[@]} baselines ($WHY), $JOBS at a time. Logs: $LOGS"
  fi
}

# deal_lanes: RUN_REFS dealt to the JOBS lanes of this machine, in LANES (a string of refs a lane, in the order they run)
deal_lanes() {
  local ref k j n least
  LANES=() # the refs of each lane, in the order they run
  for ((k = 0; k < JOBS; k++)); do LANES+=(''); done
  legs_of() { local w; read -ra w <<<"$1"; echo "${#w[@]}"; }
  for ref in "${RUN_REFS[@]}"; do
    k=0
    if [[ $ref != "$NEWEST" ]] && movable "$ref"; then
      # the lane with the fewest legs; lane 0 counts the newest baseline, which it runs last, and drills 3 and 4 after it
      # (74 s of the drills' 105 s, about three quarters of a rehearsal's 100 s, counted as one)
      least=$(($(legs_of "${LANES[0]}") + 2))
      for ((j = 1; j < JOBS; j++)); do
        n=$(legs_of "${LANES[j]}")
        if ((n < least)); then least=$n; k=$j; fi
      done
    fi
    LANES[k]+=" $ref"
  done
}
