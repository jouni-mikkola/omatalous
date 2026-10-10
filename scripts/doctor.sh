#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# Omatalous doctor: a read-only check of this instance. Run it in the instance's directory
# when something is wrong.
#
#   ./scripts/doctor.sh          text
#   ./scripts/doctor.sh --json   one line of JSON, for the maintenance helper
#
# One line per check, and on a problem the exact next command. Changes nothing, prints no
# secrets (log lines are cut and long tokens hidden). Exit code: 0 all well, 1 a problem,
# 2 only warnings.
# ──────────────────────────────────────────────────────────────────────────────
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1
ROOT="$(pwd)"

JSON=false
case ${1:-} in
  "") ;;
  --json) JSON=true ;;
  *) echo "Käyttö: ./scripts/doctor.sh [--json]" >&2; exit 64 ;;
esac
# --json: no text, one line of JSON at the end for the maintenance helper (Asetukset > Palvelin > Ylläpito)
$JSON && exec 3>&1 1>/dev/null

bold=$'\e[1m'; dim=$'\e[2m'; green=$'\e[32m'; yellow=$'\e[33m'; red=$'\e[31m'; reset=$'\e[0m'
PROBLEMS=0; WARNINGS=0
SECTION=doctor; ITEMS=""; NITEMS=0
# the text of a check for JSON: no escapes or control characters, no quotes or backslashes, cut short
jtext() { printf '%s' "$1" | sed -E 's/\x1b\[[0-9;]*[A-Za-z]//g' | tr -d '\000-\037\\"' | cut -c1-"${2:-200}"; }
record() { # record LEVEL TITLE DETAIL HINT
  NITEMS=$((NITEMS + 1)); ((NITEMS <= 40)) || return 0
  ITEMS+="${ITEMS:+,}{\"id\":\"$(jtext "$SECTION" 20)-$NITEMS\",\"level\":\"$1\",\"title\":\"$(jtext "$2" 100)\",\"detail\":\"$(jtext "$3" 300)\",\"hint\":\"$(jtext "$4" 300)\"}"
}
ok()   { record ok "$*" "" ""; printf '%s✓%s %s\n' "$green" "$reset" "$*"; }
warn() { WARNINGS=$((WARNINGS + 1)); record warn "$1" "" "${2:-}"; printf '%s!%s %s\n' "$yellow" "$reset" "$1"; shift; for l in "$@"; do printf '    %s%s%s\n' "$dim" "$l" "$reset"; done; }
bad()  { PROBLEMS=$((PROBLEMS + 1)); record error "$1" "" "${2:-}"; printf '%s✗%s %s\n' "$red" "$reset" "$1"; shift; for l in "$@"; do printf '    %s→%s %s\n' "$bold" "$reset" "$l"; done; }
head_() { SECTION=$(printf '%s' "$*" | tr 'A-Z' 'a-z' | tr -cd 'a-z0-9'); printf '\n%s%s%s\n' "$bold" "$*" "$reset"; }

# value of KEY in .env, read as data (never sourced)
env_val() { [[ -f .env ]] && grep -E "^$1=" .env | tail -1 | cut -d= -f2- || true; }
# seconds to a short Finnish span
span() {
  local s=$1
  if ((s < 120)); then echo "${s} s"; elif ((s < 7200)); then echo "$((s / 60)) min"
  elif ((s < 172800)); then echo "$((s / 3600)) h"; else echo "$((s / 86400)) vrk"; fi
}
epoch() { date -d "$1" +%s 2>/dev/null || echo 0; }
human_kb() { awk -v k="$1" 'BEGIN { if (k >= 1048576) printf "%.1f Gt", k / 1048576; else if (k >= 1024) printf "%.0f Mt", k / 1024; else printf "%d kt", k }'; }
# hide what must never show: long token-like strings, JSON bodies, bearer headers; cut the line
scrub() {
  sed -E 's/Bearer +[^ ]+/Bearer …/g; s/eyJ[A-Za-z0-9._-]{8,}/…/g; s/[A-Za-z0-9+\/_=-]{32,}/…/g; s/\{.*$/{…}/' | cut -c1-170
}

INSTANCE=$(env_val INSTANCE_NAME); INSTANCE=${INSTANCE:-${INSTANCE_NAME:-banking-app}}
printf '%sOmatalouden tarkistus%s  asennus %s%s%s, kansio %s\n' "$bold" "$reset" "$bold" "$INSTANCE" "$reset" "$ROOT"

# ── Docker ───────────────────────────────────────────────────────────────────
head_ "Docker"
DOCKER_OK=false
if ! command -v docker >/dev/null; then
  bad "Docker puuttuu." "curl -fsSL https://get.docker.com | sudo sh   (tai aja ./scripts/install.sh, se tarjoaa asennusta)"
elif ! docker compose version >/dev/null 2>&1; then
  bad "Docker Compose v2 puuttuu." "sudo apt install docker-compose-plugin   (tai asenna Docker uudelleen: curl -fsSL https://get.docker.com | sudo sh)"
else
  ok "Docker $(docker --version 2>/dev/null | sed -E 's/Docker version ([^,]+),.*/\1/'), Compose $(docker compose version --short 2>/dev/null)"
  err=$(docker info 2>&1 >/dev/null | head -3)
  if docker info >/dev/null 2>&1; then
    DOCKER_OK=true
    ok "Docker-palvelu vastaa (Docker $(docker version --format '{{.Server.Version}}' 2>/dev/null))"
  elif [[ $err == *"permission denied"* ]]; then
    bad "Käyttäjällä $(id -un) ei ole oikeutta Dockeriin." "sudo usermod -aG docker \$USER   ja kirjaudu ulos ja sisään (tai aja: newgrp docker)"
  else
    bad "Docker-palvelu ei vastaa." "sudo systemctl start docker   (jos ei auta: sudo journalctl -u docker -n 30)"
  fi
  if command -v systemctl >/dev/null && systemctl list-unit-files docker.service >/dev/null 2>&1 \
    && systemctl cat docker.service >/dev/null 2>&1; then
    state=$(systemctl is-enabled docker 2>/dev/null || true)
    if [[ $state == enabled ]]; then ok "Docker käynnistyy koneen mukana"
    else warn "Docker ei käynnisty koneen käynnistyessä (tila: ${state:-tuntematon}), sovellus ei palaa itsestään." "sudo systemctl enable docker"; fi
  fi
fi

# ── configuration ────────────────────────────────────────────────────────────
head_ "Asetukset"
if [[ -f .env ]]; then
  PORT=$(env_val HOST_PORT); PORT=${PORT:-8080}
  BIND=$(env_val BIND_ADDRESS); BIND=${BIND:-127.0.0.1}
  URL=$(env_val APP_BASE_URL)
  ok ".env löytyy (portti $BIND:$PORT, osoite ${URL:-?})"
  mode=$(stat -c %a .env 2>/dev/null || echo "")
  [[ -z $mode || $mode == 600 ]] || warn ".env:n oikeudet ovat $mode, tiedostossa on avaimia." "chmod 600 .env"
else
  PORT=8080; BIND=127.0.0.1; URL=""
  warn "Kansiossa ei ole .env-tiedostoa, joten asennusta ei ole tehty tähän kansioon." "./scripts/install.sh"
fi

# ── container ────────────────────────────────────────────────────────────────
CID=""; RUNNING=false; IMAGE_ID=""
head_ "Kontti"
if $DOCKER_OK; then
  CID=$(docker compose ps -a -q banking 2>/dev/null | head -1)
  if [[ -z $CID ]]; then
    bad "Konttia ei ole." "./scripts/install.sh"
  else
    IFS='|' read -r st health restarts started exitcode oom IMAGE_ID < <(docker inspect -f '{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{end}}|{{.RestartCount}}|{{.State.StartedAt}}|{{.State.ExitCode}}|{{.State.OOMKilled}}|{{.Image}}' "$CID" 2>/dev/null)
    up=$(( $(date +%s) - $(epoch "$started") ))
    case $st in
      running)
        RUNNING=true
        if [[ $restarts -ge 3 && $up -lt 600 ]]; then
          bad "Kontti käynnistyy yhä uudelleen ($restarts kertaa, viimeksi $(span $up) sitten)." "docker compose logs --tail 40 banking" "Jos vika alkoi päivityksestä: ./scripts/update.sh --rollback"
        elif [[ $health == healthy ]]; then
          ok "Kontti käynnissä ja terve (käynnistetty $(span $up) sitten)"
        elif [[ $health == starting ]]; then
          warn "Kontti käynnistyy vielä (terveystarkistus kesken)." "Odota minuutti ja aja uudelleen. Jos ei auta: docker compose logs --tail 40 banking"
        elif [[ $health == unhealthy ]]; then
          bad "Kontti käynnissä, mutta terveystarkistus epäonnistuu." "docker compose logs --tail 40 banking" "docker compose restart banking"
        else
          ok "Kontti käynnissä (käynnistetty $(span $up) sitten)"
        fi
        if [[ $restarts -gt 0 && ! ($restarts -ge 3 && $up -lt 600) ]]; then
          warn "Kontti on käynnistynyt uudelleen $restarts kertaa (kone tai Docker uudelleenkäynnistyi, tai sovellus kaatui)." "docker compose logs --tail 60 banking"
        fi
        ;;
      restarting)
        bad "Kontti kaatuu ja käynnistyy uudelleen koko ajan ($restarts kertaa)." "docker compose logs --tail 40 banking" "Jos vika alkoi päivityksestä: ./scripts/update.sh --rollback" ;;
      *)
        extra=""; [[ $oom == true ]] && extra=" (muisti loppui, nosta koneen muistia)"
        bad "Kontti ei ole käynnissä (tila $st, poistumiskoodi $exitcode$extra)." "docker compose logs --tail 40 banking" "docker compose up -d" ;;
    esac
  fi
else
  warn "Ohitettu, koska Docker ei vastaa."
fi

# ── port ─────────────────────────────────────────────────────────────────────
head_ "Portti"
PROBE="$BIND"; [[ $PROBE == 0.0.0.0 || $PROBE == "::" ]] && PROBE=127.0.0.1
[[ $PROBE == *:* ]] && PROBE="[$PROBE]"
http_ok() { # http_ok URL: any answer from the app's health route
  if command -v curl >/dev/null; then curl -fsS -m 5 -o /dev/null "$1" 2>/dev/null
  elif command -v wget >/dev/null; then wget -q -T 5 -O /dev/null "$1" 2>/dev/null
  else return 2; fi
}
if $DOCKER_OK && [[ -n $CID ]]; then
  bound=$(docker inspect -f '{{range $p,$b := .HostConfig.PortBindings}}{{range $b}}{{.HostIp}}:{{.HostPort}} {{end}}{{end}}' "$CID" 2>/dev/null)
  if [[ $bound == *":$PORT "* ]]; then
    ok "Portti $PORT on sidottu kontille ($BIND)"
  else
    bad "Kontin portti ei vastaa .env:n arvoa $BIND:$PORT (kontilla: ${bound:-ei porttia})." "docker compose up -d --force-recreate banking"
  fi
fi
if $RUNNING; then
  http_ok "http://$PROBE:$PORT/api/health"; rc=$?
  if ((rc == 0)); then ok "Sovellus vastaa osoitteessa http://$PROBE:$PORT"
  elif ((rc == 2)); then warn "curl ja wget puuttuvat, vastausta ei voi kokeilla koneelta." "sudo apt install curl"
  else
    holder=""
    command -v ss >/dev/null && holder=$(ss -H -ltnp "sport = :$PORT" 2>/dev/null | grep -v docker-proxy | head -1)
    if [[ -n $holder ]]; then bad "Portin $PORT on varannut jokin muu ohjelma." "ss -ltnp 'sport = :$PORT'   ja valitse toinen portti: ./scripts/install.sh"
    else bad "Sovellus ei vastaa osoitteessa http://$PROBE:$PORT." "docker compose logs --tail 40 banking" "docker compose restart banking"; fi
  fi
fi

# ── volumes and disk ─────────────────────────────────────────────────────────
head_ "Taltiot ja levy"
APP_IMAGE=""
$DOCKER_OK && APP_IMAGE=$(docker compose config --images 2>/dev/null | grep -E "^$INSTANCE:" | head -1)
APP_IMAGE=${APP_IMAGE:-$INSTANCE:latest}
# runs a command against the data volume: in the running container, else in a throwaway one from the image
in_vol() {
  if $RUNNING; then docker compose exec -T banking "$@" 2>/dev/null
  else docker compose run --rm --no-deps -T --entrypoint "$1" banking "${@:2}" 2>/dev/null; fi
}
if $DOCKER_OK; then
  proj=$(docker compose config --format json 2>/dev/null | sed -n 's/^  "name": *"\([^"]*\)".*/\1/p' | head -1)
  for v in banking-data banking-secrets; do
    if docker volume inspect "${proj}_$v" >/dev/null 2>&1; then
      if $RUNNING || docker image inspect "$APP_IMAGE" >/dev/null 2>&1; then
        path=/data; [[ $v == banking-secrets ]] && path=/secrets
        kb=$(in_vol du -sk "$path" | awk '{print $1}')
        ok "Taltio ${proj}_$v${kb:+ ($(human_kb "$kb"))}"
      else
        ok "Taltio ${proj}_$v"
      fi
    else
      bad "Taltiota ${proj}_$v ei ole. Tiedot puuttuvat tai nimi on muuttunut." "docker volume ls   ja tarvittaessa palauta varmuuskopio: docs/INSTALL.md#backups"
    fi
  done
fi
disk() { # disk LABEL PATH
  local kb pct
  [[ -d $2 ]] || return 0
  read -r kb pct < <(df -Pk "$2" 2>/dev/null | awk 'NR==2 {gsub("%", "", $5); print $4, $5}')
  [[ -n ${kb:-} ]] || return 0
  if ((kb < 512 * 1024)); then bad "$1: vapaata vain $(human_kb "$kb") ($pct % käytössä)." "docker image prune -f; docker builder prune -f   ja tyhjennä tilaa; päivitys ja rakennus tarvitsevat noin 2 Gt"
  elif ((kb < 2 * 1024 * 1024)); then warn "$1: vapaata $(human_kb "$kb") ($pct % käytössä), päivitys tarvitsee noin 2 Gt." "docker image prune -f   ja docker builder prune -f"
  else ok "$1: vapaata $(human_kb "$kb") ($pct % käytössä)"; fi
}
disk "Levy (kansio $ROOT)" "$ROOT"
if $DOCKER_OK; then
  root=$(docker info -f '{{.DockerRootDir}}' 2>/dev/null)
  [[ -n $root && $(df -P "$root" 2>/dev/null | awk 'NR==2 {print $1}') != $(df -P "$ROOT" | awk 'NR==2 {print $1}') ]] && disk "Levy (Dockerin data)" "$root"
fi

# ── backups ──────────────────────────────────────────────────────────────────
head_ "Varmuuskopiot"
newest=$(ls -1t backups/talous-*.db.gz backups/talous-*.db.age backups/talous-*.db 2>/dev/null | head -1)
if [[ -n $newest ]]; then
  age=$(( $(date +%s) - $(stat -c %Y "$newest") ))
  if ((age > 3 * 86400)); then warn "Uusin varmuuskopio on $(span $age) vanha ($newest)." "./scripts/backup.sh   ja ajasta se: docs/INSTALL.md#backups"
  else ok "Uusin varmuuskopio $(span $age) vanha ($newest)"; fi
else
  warn "Kansiossa backups/ ei ole varmuuskopioita." "./scripts/backup.sh   ja ajasta se: docs/INSTALL.md#backups"
fi
if $DOCKER_OK && { $RUNNING || docker image inspect "$APP_IMAGE" >/dev/null 2>&1; }; then
  auto=$(in_vol node -e '
    const fs = require("node:fs");
    try {
      const f = fs.readdirSync("/data/backups").filter((n) => /^auto-.*\.db$/.test(n))
        .map((n) => ({ n, t: fs.statSync("/data/backups/" + n).mtimeMs / 1000 })).sort((a, b) => b.t - a.t);
      console.log(f.length + " " + Math.floor(f[0]?.t ?? 0));
    } catch { console.log("0 0"); }' | tail -1)
  read -r acount atime <<<"${auto:-0 0}"
  if [[ ${acount:-0} -gt 0 ]]; then
    aage=$(( $(date +%s) - atime ))
    if ((aage > 2 * 86400)); then warn "Sovelluksen oma päiväkopio on $(span $aage) vanha ($acount kpl taltiossa)." "docker compose logs banking | grep -i varmuus"
    else ok "Sovelluksen oma päiväkopio $(span $aage) vanha ($acount kpl taltiossa)"; fi
  else
    warn "Taltiossa ei ole vielä sovelluksen omaa päiväkopiota (tulee ensimmäisen vuorokauden aikana)."
  fi
fi

# ── version ──────────────────────────────────────────────────────────────────
head_ "Versio"
if $RUNNING; then
  runv=$(docker compose exec -T banking node --disable-warning=ExperimentalWarning dist/node.js version 2>/dev/null | tail -1)
  srcv=$(sed -n 's/.*APP_VERSION = "\([^"]*\)".*/\1/p' apps/server/src/version.ts 2>/dev/null)
  if [[ -z $runv ]]; then warn "Sovelluksen versiota ei saatu luettua." "docker compose logs --tail 20 banking"
  elif [[ -n $srcv && $runv != "$srcv "* ]]; then
    bad "Käynnissä on $runv, mutta kansion koodi on versio $srcv." "./scripts/update.sh"
  else ok "Käynnissä $runv"; fi
fi
if command -v git >/dev/null && git rev-parse --git-dir >/dev/null 2>&1; then
  head_c=$(git rev-parse HEAD 2>/dev/null)
  label=""
  [[ -n $IMAGE_ID ]] && label=$(docker image inspect -f '{{index .Config.Labels "talous.commit"}}' "$IMAGE_ID" 2>/dev/null)
  if [[ -z $label || $label == unknown ]]; then
    $RUNNING && warn "Imagen koontikohtaa ei tiedetä (rakennettu ilman päivitysskriptiä), kansion koodi on $(git rev-parse --short HEAD)." "./scripts/update.sh"
  elif [[ $label != "$head_c" ]]; then
    bad "Image on rakennettu koodista ${label:0:7}, kansiossa on ${head_c:0:7}." "./scripts/update.sh"
  else ok "Image vastaa kansion koodia (${head_c:0:7})"; fi
  if [[ -n $(git status --porcelain --untracked-files=no 2>/dev/null) ]]; then
    warn "Kansiossa on paikallisia muutoksia, update.sh ei aja niiden kanssa." "git status"
  fi
  upstream=$(git rev-parse '@{u}' 2>/dev/null || true)
  if [[ -n $upstream && $upstream != "$head_c" ]]; then
    n=$(git rev-list --count "HEAD..$upstream" 2>/dev/null || echo "?")
    [[ $n != 0 ]] && warn "Etärepositoriossa voi olla $n uutta muutosta (viimeksi haetun tiedon mukaan)." "./scripts/update.sh"
  fi
fi

# ── log ──────────────────────────────────────────────────────────────────────
head_ "Loki"
if $DOCKER_OK && [[ -n $CID ]]; then
  errs=$(docker compose logs --no-color --tail 300 banking 2>&1 | grep -iE 'error|virhe|fatal|exception|TIETOKANTA|uncaught|ENOSPC|SQLITE' | tail -5 | scrub)
  if [[ -n $errs ]]; then
    warn "Lokin viimeisimmät virheet (arkaluontoinen osa piilotettu):"
    while IFS= read -r l; do printf '      %s\n' "$l"; done <<<"$errs"
    printf '    %s→ docker compose logs --tail 100 banking%s\n' "$dim" "$reset"
  else ok "Lokissa ei näy virheitä"; fi
fi

# ── address ──────────────────────────────────────────────────────────────────
head_ "Osoite"
if [[ -n $URL ]]; then
  if [[ $URL == http://localhost* || $URL == http://127.* ]]; then
    ok "Osoite $URL on vain tälle koneelle"
  else
    http_ok "$URL/api/health" >/dev/null 2>&1; rc=$?
    if ((rc == 0)); then ok "Osoite $URL vastaa"
    elif ((rc == 2)); then warn "Osoitetta ei voi kokeilla ilman curlia." "sudo apt install curl"
    else
      case $URL in
        https://*) hint="DNS, porttien 80 ja 443 ohjaus ja sertifikaatti: docker compose logs caddy   (tai tunnelin tila Cloudflaressa)" ;;
        *) hint="onko osoite koneen oma ja portti $PORT auki kotiverkossa" ;;
      esac
      warn "Osoite $URL ei vastaa tältä koneelta." "$hint" "Jos osoite toimii muualta, tämä voi johtua siitä, ettei kone yllä omaan julkiseen osoitteeseensa."
    fi
  fi
else
  warn "Osoitetta ei ole asetettu .env-tiedostossa." "./scripts/install.sh"
fi

# ── home network address ─────────────────────────────────────────────────────
host_addr_list() { ip -4 -o addr show 2>/dev/null | awk '{split($4, a, "/"); print a[1]}'; }
if [[ -f .env && -n ${BIND:-} && $BIND != 127.0.0.1 && $BIND != localhost && $BIND != 0.0.0.0 && $BIND != "::" ]] && command -v ip >/dev/null; then
  head_ "Kotiverkon osoite"
  if host_addr_list | grep -qxF "$BIND"; then
    ok "Koneella on osoite $BIND"
    urlhost=${URL#*://}; urlhost=${urlhost%%/*}; urlhost=${urlhost%:*}
    if [[ -n $URL && $urlhost != "$BIND" ]]; then
      warn "Osoite $URL ei ole sama kuin kuunteluosoite $BIND." "Päivitä osoite: Asetukset > Palvelin, tai aja ./scripts/install.sh --reconfigure"
    fi
  else
    warn "Koneella ei ole enää osoitetta $BIND (reitittimen DHCP antoi uuden?), joten sovellus ei välttämättä ole tavoitettavissa." \
      "Varaa koneelle kiinteä osoite reitittimestä ja aja ./scripts/install.sh --reconfigure" \
      "Jos kontti ei käynnisty koneen käynnistyessä, kun osoite ei ole vielä olemassa: sudo sysctl -w net.ipv4.ip_nonlocal_bind=1"
  fi
fi

# ── maintenance helper ───────────────────────────────────────────────────────
head_ "Ylläpitoapuri"
UNIT="talous-ops-$INSTANCE"
HELPER_KIND=""
if command -v systemctl >/dev/null && systemctl --user is-enabled "$UNIT.timer" >/dev/null 2>&1; then HELPER_KIND=systemd
elif command -v crontab >/dev/null && crontab -l 2>/dev/null | grep -qE " # talous-ops:$INSTANCE\$"; then HELPER_KIND=cron; fi
if [[ -z $HELPER_KIND ]]; then
  warn "Ylläpitoapuri ei ole käytössä, joten päivitys ja varmuuskopio eivät onnistu selaimesta." "./scripts/install.sh --ops-helper"
elif [[ $(id -u) -eq 0 ]]; then
  # the helper refuses to run as root, so waiting for it would never end
  warn "Ylläpitoapuri on ajastettu pääkäyttäjälle ($HELPER_KIND), mutta se ei toimi pääkäyttäjänä." "Poista: ./scripts/install.sh --ops-helper-off   ja asenna uudelleen tavallisella käyttäjällä: ./scripts/install.sh --ops-helper"
else
  ok "Ylläpitoapuri ajastettu ($HELPER_KIND)"
  if [[ -f ops/helper-seen ]]; then
    hage=$(( $(date +%s) - $(stat -c %Y ops/helper-seen) ))
    if ((hage < 300)); then ok "Apuri on käynyt $(span $hage) sitten"
    else warn "Apuri ei ole käynyt $(span $hage) aikaan." "$([[ $HELPER_KIND == systemd ]] && echo "systemctl --user status $UNIT.timer   ja: journalctl --user -u $UNIT.service -n 20" || echo "tail -n 20 ops/helper.log")"; fi
  else
    warn "Apuri ei ole vielä käynyt." "Odota minuutti ja aja tämä uudelleen. Jos ei auta: ./scripts/ops-helper.sh"
  fi
  if [[ $HELPER_KIND == systemd ]] && command -v loginctl >/dev/null && [[ $(loginctl show-user "$(id -un)" -p Linger --value 2>/dev/null) == no ]]; then
    warn "Käyttäjän palvelut eivät käynnisty koneen käynnistyessä (linger pois), apuri toimii vasta kirjautumisen jälkeen." "sudo loginctl enable-linger $(id -un)"
  fi
fi
if [[ -n $HELPER_KIND && ! -f ops/allowed_signers ]] && grep -qE '^TALOUS_CHANNEL=source$' .env 2>/dev/null; then
  warn "Päivitykset eivät ole allekirjoitettuja: lähdekanava luottaa jokaiseen, joka voi kirjoittaa päähaaraan." "Julkaisukanava tarkistaa allekirjoituksen itse (poista TALOUS_CHANNEL=source tiedostosta .env), tai lisää avaimet tiedostoon ops/allowed_signers (docs/SECURITY.md)"
fi
if [[ -f ops/RECOVERY.txt ]]; then
  bad "Päivitys epäonnistui eikä palautus onnistunut." "cat ops/RECOVERY.txt"
fi
if [[ -f ops/helper.log ]] && tail -n 20 ops/helper.log 2>/dev/null | grep -qE 'oikeudet|\.env ei kelpaa'; then
  warn "Apuri kieltäytyy toimimasta: $(tail -n 20 ops/helper.log | grep -E 'oikeudet|\.env ei kelpaa' | tail -1 | cut -d' ' -f2- | scrub)" "tail -n 20 ops/helper.log"
fi

# ── JSON ─────────────────────────────────────────────────────────────────────
if $JSON; then
  printf '{"at":"%s","items":[%s]}\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$ITEMS" >&3
  exit 0
fi

# ── verdict ──────────────────────────────────────────────────────────────────
printf '\n'
if ((PROBLEMS > 0)); then
  printf '%s✗ %d ongelmaa%s%s. Korjaa ylhäältä alkaen ja aja ./scripts/doctor.sh uudelleen.\n' "$red" "$PROBLEMS" "$reset" "$( ((WARNINGS)) && echo ", $WARNINGS varoitusta" )"
  exit 1
elif ((WARNINGS > 0)); then
  printf '%s! Ei ongelmia, %d varoitusta.%s\n' "$yellow" "$WARNINGS" "$reset"
  exit 2
fi
printf '%s✓ Kaikki kunnossa.%s\n' "$green" "$reset"
