# shellcheck shell=bash disable=SC2034
# The check for a new version, for scripts/ops-helper.sh: fetch_release asks the GitHub Releases API, write_check_frag
# writes ops/check.frag from the answer held and check_update does both. Moved out of the helper; the helper's
# load_libs sources this file after check_permissions, under its lock. It uses the helper's T_CHECK, OPS,
# OPS_HELPER_VERSION, env_get, pol_get, json_str, now_iso, say_log, current_version, semver_gt and git_policy, and sets
# REL_STATUS, REL_TAG, REL_NOTES, CHECK_MODE and UPDATE_AVAILABLE, which act_update and act_check_update read. Which release
# an install follows (the latest, or with TALOUS_PRERELEASE=yes the newest) is decided in lib/release.sh, as for update.sh.
# The switch that sets that line (act_prerelease, last in this file) also uses the helper's env_check, fail and LOGF,
# installer_lock of lib/release.sh and envfile_write of lib/envfile.sh.

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

# ── the switch for pre-releases: the actions prerelease-on and prerelease-off ──
# A request of the switch is its name and nothing else. run_request turns the name into `yes` or `no`, the helper's own
# two words, so nothing the app says is ever written. One line of .env changes, the one release_mode (lib/release.sh) reads.
#
# The line TALOUS_PRERELEASE=WANT is written by the one writer of .env (envfile_write, lib/envfile.sh), in place. Every
# other byte stays: the last line of the key is replaced where it stands and earlier ones go, and a file without the key
# gets it as a new last line (after a newline of its own when the file ends without one). A last line without a newline
# stays as it is. The new file is .env.new (made anew, never through a link), gets the owner, group and mode of .env
# and takes its place in one rename. A file that says so already is not rewritten. .env.new is gone on every way out,
# and main removes one that a killed helper left.
# The action. The tick's env_check passed before the poll (main); it is asked again right before the write, and a file it
# would refuse stays as it is. A source install follows a branch and has no releases to follow. The rewrite holds the
# installer's lock, which install.sh and update.sh read and rewrite .env under, in a subshell that lets go of it. Then
# the check of check-update, so the page shows at once which version is on offer now. When that check gets no answer the
# setting stands and the daily check is due again at the next idle tick.
act_prerelease() { # act_prerelease yes|no
  local want=$1 rc=0 mode=latest
  echo "STEP: 1/2 Tallennetaan asetus" >>"$LOGF"
  [[ -f .env ]] || { fail "Asennuksen .env-tiedostoa ei ole. Mitään ei muutettu."; return; }
  if ! env_check; then say_log ".env is invalid: $ENV_ERR."; fail "Tiedosto .env ei ole kelvollinen. Mitään ei muutettu."; return; fi
  if [[ $(env_get TALOUS_CHANNEL) == source ]]; then fail "Tämä asennus päivittyy lähdekoodista eikä julkaistuista versioista. Mitään ei muutettu."; return; fi
  (installer_lock || exit 3; envfile_write .env place same "TALOUS_PRERELEASE=$want") || rc=$?
  if ((rc == 3)); then fail "Palvelimella on asennus tai päivitys kesken. Mitään ei muutettu."; return; fi
  if ((rc != 0)); then fail "Tiedostoa .env ei voitu kirjoittaa. Mitään ei muutettu."; return; fi
  # Read back as the daily check reads it: a line the reader does not see (grep reads nothing from a file with a NUL byte
  # in it) is no setting, and the page must not say done when the host reads otherwise.
  [[ $want != yes ]] || mode=newest
  if [[ $(release_mode 2>/dev/null) != "$mode" ]]; then
    say_log "TALOUS_PRERELEASE=$want was written, but the daily check does not read it from .env."
    fail "Asetus kirjoitettiin tiedostoon .env, mutta apuri ei saa sitä sieltä luettua. Tarkista tiedosto palvelimella."
    return
  fi
  say_log "TALOUS_PRERELEASE=$want is the setting in .env."
  echo "STEP: 2/2 Tarkistetaan uusi versio" >>"$LOGF"
  if [[ $want == yes ]]; then SUMMARY="Uudet versiot tarjotaan heti."; else SUMMARY="Uudet versiot tarjotaan kaksi päivää julkaisun jälkeen."; fi
  if check_update; then [[ $UPDATE_AVAILABLE != true ]] || SUMMARY+=" Uusi versio on saatavilla."
  else rm -f "$OPS/last-check"; SUMMARY+=" Uutta versiota ei voitu tarkistaa."; fi
}
