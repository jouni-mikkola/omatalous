# shellcheck shell=bash disable=SC2034
# The check for a new version, for scripts/ops-helper.sh: fetch_release asks the GitHub Releases API, write_check_frag
# writes ops/check.frag from the answer held and check_update does both. Moved out of the helper; the helper's
# load_libs sources this file after check_permissions, under its lock. It uses the helper's T_CHECK, OPS,
# OPS_HELPER_VERSION, env_get, pol_get, json_str, now_iso, say_log, current_version, semver_gt and git_policy, and sets
# REL_STATUS, REL_TAG, REL_NOTES, CHECK_MODE and UPDATE_AVAILABLE, which act_update and act_check_update read. Which release
# an install follows (the latest, or with TALOUS_PRERELEASE=yes the newest) is decided in lib/release.sh, as for update.sh.

# shellcheck source=release.sh
. "$LIB/release.sh" || return 1
REL_STATUS=""; REL_TAG=""; REL_NOTES=""
# Asks the GitHub Releases API which release this install follows. REL_STATUS: ok, none (no release yet, and no release tag
# in this folder: "no release" with one here is no answer, release_answer fails) or error.
fetch_release() {
  local tmp mode row rc=0
  REL_STATUS=error; REL_TAG=""; REL_NOTES=""
  mode=$(release_mode) || return 1
  tmp=$(mktemp "$OPS/run/release.XXXXXX") || return 1
  row=$(release_answer "$mode" "$tmp") || rc=$?
  rm -f "$tmp"
  if ((rc == 2)); then REL_STATUS=none; return 0; fi
  ((rc == 0)) || return 1
  REL_TAG=${row%%$'\t'*}
  # the notes are a JSON string on one line: unescape it, scrub it, keep 3000 characters
  REL_NOTES=$(printf '%s\n' "${row#*$'\t'}" | awk '{
      s = $0; out = ""; n = length(s)
      for (i = 1; i <= n; i++) {
        c = substr(s, i, 1)
        if (c == "\\") { i++; d = substr(s, i, 1)
          if (d == "n") out = out "\n"; else if (d == "t") out = out " "; else if (d == "u") { i += 4; out = out "?" } else if (d != "r") out = out d
        } else out = out c
      }
      printf "%s", out }' | sed -E 's/\x1b\[[0-9;?]*[A-Za-z]//g' | tr -d '\000-\011\013-\037\177' | sed -E 's/[A-Za-z0-9_=-]{40,}/[piilotettu]/g' | head -c 3000)
  REL_STATUS=ok
}
CHECK_MODE=""; UPDATE_AVAILABLE=false   # CHECK_MODE: release | source
# Writes ops/check.frag from the answer already held (REL_TAG and REL_NOTES, or the local refs), never fetching, so
# act_update can rewrite it after the switch. A rollback has no answer to rewrite and deletes the file instead.
write_check_frag() {
  local cur avail=false ver commits="" n=0 line hash subj
  if [[ $CHECK_MODE == release ]]; then
    ver=${REL_TAG#v}; cur=$(current_version || true); [[ -n $cur ]] && semver_gt "$ver" "$cur" && avail=true
    printf '"update_available":%s,"latest_version":"%s","release_notes":%s,"checked_at":"%s"' "$avail" "$ver" "$(json_str "$REL_NOTES")" "$(now_iso)" >"$OPS/check.frag"
    say_log "Latest release: $ver, running: ${cur:-?}."
  else
    while IFS= read -r line; do
      hash=${line%% *}; subj=${line#* }; [[ $hash =~ ^[0-9a-f]{4,40}$ ]] || continue
      commits+="${commits:+,}{\"hash\":\"$hash\",\"subject\":$(json_str "${subj:0:100}")}"; n=$((n + 1))
    done < <(git log --format='%h %s' -30 "HEAD..origin/$(pol_get BRANCH)" 2>/dev/null | tr -d '\000-\010\013-\037\177')
    ((n > 0)) && avail=true
    printf '"update_available":%s,"behind_commits":[%s],"checked_at":"%s"' "$avail" "$commits" "$(now_iso)" >"$OPS/check.frag"
    say_log "Source channel: ${n} new changes."
  fi
  UPDATE_AVAILABLE=$avail
}
# The network part, then write_check_frag. Returns 1 when the answer could not be had (offline), nothing else changes then.
check_update() {
  local channel branch
  channel=$(env_get TALOUS_CHANNEL); CHECK_MODE=source
  if [[ $channel != source ]]; then
    fetch_release || { say_log "Could not get release information (no network or GitHub does not answer)."; return 1; }
    [[ $REL_STATUS == ok ]] && CHECK_MODE=release
    if [[ $channel == release && $CHECK_MODE != release ]]; then say_log "TALOUS_CHANNEL=release but there are no releases yet."; return 1; fi
  fi
  if [[ $CHECK_MODE != release ]]; then
    git_policy || { say_log "$GIT_MSG."; return 1; }; branch=$(pol_get BRANCH)
    timeout -k 5 "$T_CHECK" git fetch --quiet --no-tags origin "refs/heads/$branch:refs/remotes/origin/$branch" 2>/dev/null || { say_log "Could not check the source (no network)."; return 1; }
  fi
  write_check_frag
}
