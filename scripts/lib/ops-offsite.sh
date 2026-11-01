# shellcheck shell=bash
# The `offsite` action of scripts/ops-helper.sh: an encrypted copy of the database and the app secret to another machine
# over SFTP, with the target the app has prepared. The helper's load_libs sources this file after check_permissions has
# passed on scripts/lib; it defines functions and nothing else. It uses the helper's in_app, run_cap, fail, step_say,
# check_disk, t_for and OPS.
#
# The target comes from the app, so nothing of it is trusted: it is read only as the one line `ops offsite` prints, the
# line must match one exact shape and each value its one form (the same forms as apps/server/src/services/offsite-request.ts
# and platform/validate.ts). No form lets through a space, a quote, a `$`, a backslash or a leading dash, so a value is
# one value in the environment of scripts/offsite.sh and one word in an sftp command. The SSH key is written to a file
# of mode 600 for the run and removed after it, and is never put in the log, the journal or the summary.

OFFSITE_MAX=4096
T_OFFSITE=$(t_for 1800 OFFSITE)
O_LABEL='[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?'
O_RE_HOST="^$O_LABEL(\\.$O_LABEL)*\$"
O_RE_LINE='^\{"host":"([^"\\]*)","port":([0-9]{1,5}),"user":"([^"\\]*)","dir":"([^"\\]*)","recipient":"([^"\\]*)","key":"([A-Za-z0-9+/=]*)"\}$'

# Reads what the app prepared into O_HOST, O_PORT, O_USER, O_DIR, O_RECIPIENT and O_KEY (the PEM). Returns 1 with the reason in O_ERR.
offsite_read() {
  local LC_ALL=C out none="Mitään ei lähetetty."
  O_ERR=""; O_HOST=""; O_PORT=""; O_USER=""; O_DIR=""; O_RECIPIENT=""; O_KEY=""
  out=$(in_app dist/node.js ops offsite --helper "$OPS_HELPER_VERSION" 2>/dev/null | head -c $((OFFSITE_MAX + 1))) || out=""
  if [[ -z $out ]]; then O_ERR="Sovellus ei kertonut kopion kohdetta. $none"; return 1; fi
  if [[ $out == '{"host":null}' ]]; then O_ERR="Kopion kohdetta ei ole valmisteltu."; return 1; fi
  if ((${#out} > OFFSITE_MAX)) || [[ $out == *[![:print:]]* || ! $out =~ $O_RE_LINE ]]; then O_ERR="Kopion kohde ei ole odotetussa muodossa. $none"; return 1; fi
  O_HOST=${BASH_REMATCH[1]}; O_PORT=${BASH_REMATCH[2]}; O_USER=${BASH_REMATCH[3]}; O_DIR=${BASH_REMATCH[4]}; O_RECIPIENT=${BASH_REMATCH[5]}
  local b64=${BASH_REMATCH[6]}
  if ((${#O_HOST} > 253)) || [[ ! $O_HOST =~ $O_RE_HOST ]]; then O_ERR="Toisen koneen osoite ei ole kelvollinen. $none"; return 1; fi
  if ((10#$O_PORT < 1 || 10#$O_PORT > 65535)); then O_ERR="Portti ei ole kelvollinen. $none"; return 1; fi
  if [[ ! $O_USER =~ ^[a-z0-9_][a-z0-9_.-]{0,31}$ ]]; then O_ERR="Käyttäjätunnus ei ole kelvollinen. $none"; return 1; fi
  if [[ ! $O_DIR =~ ^[A-Za-z0-9_./][A-Za-z0-9_./-]{0,119}$ || $O_DIR == *//* || /$O_DIR/ == */../* ]]; then O_ERR="Kansio ei ole kelvollinen. $none"; return 1; fi
  if [[ ! $O_RECIPIENT =~ ^age1[qpzry9x8gf2tvdw0s3jn54khce6mua7l]{58}$ ]]; then O_ERR="Salausavain ei ole kelvollinen. $none"; return 1; fi
  O_KEY=$(printf '%s' "$b64" | base64 -d 2>/dev/null) || O_KEY=""
  if ((${#b64} > 600)) || [[ $O_KEY != "-----BEGIN PRIVATE KEY-----"* || $O_KEY != *"-----END PRIVATE KEY-----"* || ${#O_KEY} -gt 400 ]]; then O_ERR="SSH-avain ei ole kelvollinen. $none"; return 1; fi
}

act_offsite() {
  local keyfile=$OPS/offsite.key rc=0
  rm -f "$keyfile"
  step_say "1/3 Luetaan kopion kohde"
  offsite_read || { fail "$O_ERR"; return; }
  check_disk || { fail "$DISK_MSG"; return; }
  rm -f "$keyfile"; (umask 077; printf '%s\n' "$O_KEY" >"$keyfile")
  O_KEY=""
  step_say "2/3 Salataan kopio ja viedään se toiselle koneelle"
  run_cap "$T_OFFSITE" env OFFSITE_HOST="$O_HOST" OFFSITE_PORT="$((10#$O_PORT))" OFFSITE_USER="$O_USER" OFFSITE_DIR="$O_DIR" OFFSITE_RECIPIENT="$O_RECIPIENT" \
    OFFSITE_KEY="$ROOT/$keyfile" OFFSITE_KNOWN_HOSTS="$ROOT/$OPS/offsite_known_hosts" ./scripts/offsite.sh || rc=$?
  rm -f "$keyfile"
  step_say "3/3 Tarkistetaan tulos"
  # shellcheck disable=SC2034 # SUMMARY is read by scripts/ops-helper.sh, which sources this file
  case $rc in
    0) SUMMARY="Salattu kopio vietiin koneelle $O_HOST." ;;
    10) fail "Emme vieneet kopiota: age puuttuu tältä koneelta (sudo apt install age)." "$rc" ;;
    11) fail "Emme vieneet kopiota: sftp puuttuu tältä koneelta (sudo apt install openssh-client)." "$rc" ;;
    12) fail "Emme vieneet kopiota: yhteys koneeseen $O_HOST tai tiedostojen vienti ei onnistunut. Onko tämän koneen SSH-avain lisätty toisen koneen authorized_keys-tiedostoon?" "$rc" ;;
    13) fail "Emme vieneet kopiota: tiedoston koko toisella koneella ei täsmännyt." "$rc" ;;
    14) fail "Emme vieneet kopiota: koneen $O_HOST tunniste on muuttunut. Jos kone on vaihdettu, poista rivi tiedostosta $OPS/offsite_known_hosts." "$rc" ;;
    *) fail "Kopio toiselle koneelle ei onnistunut. Syy on lokissa." "$rc" ;;
  esac
}
