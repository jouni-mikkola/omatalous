# shellcheck shell=bash
# shellcheck disable=SC2034 # SUMMARY, KEEP_LINES, KEEP_BYTES and RC are the helper's: run_request reads them after the action
# The helper's simple actions, for scripts/ops-helper.sh. The helper's load_libs sources this file after check_permissions has
# passed on scripts/lib; it defines functions and nothing else. run_request picks each act_ function by its case; they set
# SUMMARY, STATUS and RC through fail, and write to LOGF.
#
#   act_backup, act_restart, act_doctor, act_logs, act_prune, act_helper_renew   one request each
#   run_doctor          act_doctor and heartbeat's daily block run doctor.sh and keep its answer for the page
#   reclaimed, image_id  the prune's helpers
#
# update, rollback, check-update, access and the pre-release switch are in the helper and in the other files of scripts/lib.

act_backup() {
  local stamp
  step_say "1/2 Varmuuskopio kansioon backups"
  check_disk || { fail "$DISK_MSG"; return; }
  run_cap "$T_BACKUP" ./scripts/backup.sh || { RC=$?; fail "Varmuuskopio ei onnistunut. Syy on lokissa." "$RC"; return; }
  # one more copy inside the data volume, where the page can offer it for download
  step_say "2/2 Kopio sovelluksen omaan kansioon"
  stamp=$(date -u +%Y%m%dT%H%M%SZ)
  # the copy is checked after it is written and removed when it fails (scripts/lib/dbcopy.sh)
  if run_cap "$T_BACKUP" docker compose exec -T banking "${NODE[@]}" -e "$DBCOPY_JS" 'keep:^manual-[0-9TZ]+\.db$' "/data/backups/manual-$stamp.db"; then :
  else fail "Kopio sovelluksen omaan kansioon ei onnistunut."; return; fi
  write_backups_frag
  SUMMARY="Varmuuskopio otettu."
}
act_restart() {
  step_say "1/2 Käynnistetään sovellus uudelleen"
  run_cap "$T_RESTART" docker compose restart banking || { RC=$?; fail "Uudelleenkäynnistys ei onnistunut." "$RC"; return; }
  step_say "2/2 Odotetaan että sovellus vastaa"
  if wait_healthy 45; then SUMMARY="Sovellus käynnistyi uudelleen."; else fail "Sovellus ei vastaa uudelleenkäynnistyksen jälkeen."; fi
}
# Runs doctor.sh --json and keeps its answer for the page. Exit 1 and 2 mean findings, not a failed run.
run_doctor() {
  local out rc=0
  out=$(timeout -k 10 "$T_DOCTOR" ./scripts/doctor.sh --json 2>/dev/null | head -c 60000) || rc=$?
  if [[ $out =~ ^\{\"at\":\"[0-9TZ:.-]+\",\"items\":\[.*\]\}$ && $out != *$'\n'* ]]; then
    printf '"doctor":%s' "$out" >"$OPS/doctor.frag"
    DOCTOR_PROBLEMS=$(grep -o '"level":"error"' <<<"$out" | wc -l); DOCTOR_WARNINGS=$(grep -o '"level":"warn"' <<<"$out" | wc -l)
    return 0
  fi
  return 1
}
act_doctor() {
  step_say "1/1 Tarkistetaan asennus"
  if run_doctor; then
    if ((DOCTOR_PROBLEMS > 0)); then SUMMARY="Tarkistus: $DOCTOR_PROBLEMS ongelmaa, $DOCTOR_WARNINGS varoitusta."
    elif ((DOCTOR_WARNINGS > 0)); then SUMMARY="Tarkistus: ei ongelmia, $DOCTOR_WARNINGS varoitusta."
    else SUMMARY="Tarkistus: kaikki kunnossa."; fi
  else fail "Tarkistus ei onnistunut."; fi
}

# The last 100 lines of each running service of this install. Redaction happens in store_result (scrub_out) and in the app.
act_logs() {
  local svc shown=""
  step_say "1/1 Luetaan palvelujen lokit"
  KEEP_LINES=320; KEEP_BYTES=49152
  for svc in banking caddy tunnel; do
    [[ -n $(timeout 20 docker compose ps --status running -q "$svc" 2>/dev/null) ]] || continue
    printf '== %s ==\n' "$svc" >>"$LOGF"
    run_cap "$T_LOGS" docker compose logs --no-color --tail 100 "$svc" || { RC=$?; fail "Lokien luku ei onnistunut (palvelu $svc)." "$RC"; return; }
    shown+="${shown:+, }$svc"
  done
  SUMMARY="Luettu: $shown."
}
# "Total reclaimed space: 1.2GB" from a prune's output, in Finnish units for the summary
reclaimed() { # reclaimed TEXT
  local v
  v=$(sed -n 's/^Total reclaimed space: *//p' <<<"$1" | tail -1 | tr -cd '0-9.A-Za-z' | head -c 12)
  [[ $v =~ ^[0-9.]+(B|kB|MB|GB|TB)$ ]] || v=0B
  v=${v/./,}
  sed -E 's/([0-9])(TB|GB|MB|kB|B)$/\1 \2/; s/ TB$/ Tt/; s/ GB$/ Gt/; s/ MB$/ Mt/; s/ kB$/ kt/; s/ B$/ t/' <<<"$v"
}
# Fixed commands only. docker image prune -f without -a removes images that have no tag at all, and
# builder prune -f the build cache, so this install's :latest and :previous (which update.sh and rollback
# need) are never candidates. They are checked before and after anyway. `act_prune own` (the housekeeping, lib/ops-housekeeping.sh)
# takes only the untagged images that carry this app's label talous.version, and leaves the build cache and other software alone.
image_id() { docker image inspect -f '{{.Id}}' "$1" 2>/dev/null || true; }
# shellcheck disable=SC2120 # "own" is passed by housekeeping (lib/ops-housekeeping.sh)
act_prune() {
  local start imgs cache="" id_latest id_prev own=(); [[ ${1:-} == own ]] && own=(--filter label=talous.version)
  id_latest=$(image_id "$INSTANCE:latest"); id_prev=$(image_id "$INSTANCE:previous")
  step_say "1/2 Poistetaan vanhat versiot"
  start=$(stat -c %s "$LOGF" 2>/dev/null || echo 0)
  run_cap "$T_PRUNE" docker image prune -f ${own[@]+"${own[@]}"} || { RC=$?; fail "Kuvien siivous ei onnistunut. Syy on lokissa." "$RC"; return; }
  imgs=$(reclaimed "$(tail -c +$((start + 1)) "$LOGF")")
  if [[ ${1:-} != own ]]; then
    step_say "2/2 Tyhjennetään välimuisti"
    start=$(stat -c %s "$LOGF" 2>/dev/null || echo 0)
    run_cap "$T_PRUNE" docker builder prune -f || { RC=$?; fail "Välimuistin siivous ei onnistunut. Syy on lokissa." "$RC"; return; }
    cache=$(reclaimed "$(tail -c +$((start + 1)) "$LOGF")")
  fi
  if [[ $(image_id "$INSTANCE:latest") != "$id_latest" || $(image_id "$INSTANCE:previous") != "$id_prev" ]]; then
    fail "Siivous poisti version, jonka piti jäädä."; return
  fi
  if [[ $imgs == "0 t" && ${cache:-0 t} == "0 t" ]]; then SUMMARY="Ei vapautettavaa."; else SUMMARY="Levyltä vapautui $imgs vanhoista versioista${cache:+ ja $cache välimuistista}."; fi
}
# The script schedule and the policy are installed again from this clone, with fixed arguments. Without
# --ops-policy an existing policy (remote, branch, docker) is kept, so a changed remote is not adopted here.
act_helper_renew() {
  step_say "1/1 Asennetaan apuri uudelleen tästä kansiosta"
  if run_cap "$T_RENEW" ./scripts/install.sh --ops-helper; then SUMMARY="Apuri asennettu uudelleen."; else RC=$?; fail "Apurin uusinta ei onnistunut. Syy on lokissa." "$RC"; fi
}
