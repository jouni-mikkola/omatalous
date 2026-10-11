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
  *) echo "Usage: ./scripts/doctor.sh [--json]" >&2; exit 64 ;;
esac
# --json: no text, one line of JSON at the end for the maintenance helper (Asetukset > Ylläpito)
$JSON && exec 3>&1 1>/dev/null

# t ENGLISH FINNISH: the terminal gets English, the --json items (listed by Asetukset > Ylläpito) get Finnish.
# Every check text goes through it, so a check cannot have only one language.
t() { if $JSON; then printf '%s' "$2"; else printf '%s' "$1"; fi; }

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
# head_ ENGLISH FINNISH: the item ids come from the Finnish name, so they stay as they were
head_() { SECTION=$(printf '%s' "$2" | tr 'A-Z' 'a-z' | tr -cd 'a-z0-9'); printf '\n%s%s%s\n' "$bold" "$(t "$1" "$2")" "$reset"; }

# value of KEY in .env, read as data (never sourced)
env_val() { [[ -f .env ]] && grep -E "^$1=" .env | tail -1 | cut -d= -f2- || true; }
# seconds to a short span
span() {
  local s=$1
  if ((s < 120)); then echo "${s} s"; elif ((s < 7200)); then echo "$((s / 60)) min"
  elif ((s < 172800)); then echo "$((s / 3600)) h"; else echo "$((s / 86400)) $(t d vrk)"; fi
}
epoch() { date -d "$1" +%s 2>/dev/null || echo 0; }
human_kb() { awk -v k="$1" -v g="$(t GB Gt)" -v m="$(t MB Mt)" -v b="$(t kB kt)" 'BEGIN { if (k >= 1048576) printf "%.1f %s", k / 1048576, g; else if (k >= 1024) printf "%.0f %s", k / 1024, m; else printf "%d %s", k, b }'; }
# hide what must never show: long token-like strings, JSON bodies, bearer headers; cut the line
scrub() {
  sed -E 's/Bearer +[^ ]+/Bearer …/g; s/eyJ[A-Za-z0-9._-]{8,}/…/g; s/[A-Za-z0-9+\/_=-]{32,}/…/g; s/\{.*$/{…}/' | cut -c1-170
}

INSTANCE=$(env_val INSTANCE_NAME); INSTANCE=${INSTANCE:-${INSTANCE_NAME:-banking-app}}
printf '%sOmatalous doctor%s  install %s%s%s, folder %s\n' "$bold" "$reset" "$bold" "$INSTANCE" "$reset" "$ROOT"

# ── Docker ───────────────────────────────────────────────────────────────────
head_ "Docker" "Docker"
DOCKER_OK=false
if ! command -v docker >/dev/null; then
  bad "$(t "Docker is missing." "Docker puuttuu.")" "$(t "curl -fsSL https://get.docker.com | sudo sh   (or run ./scripts/install.sh, which offers to install it)" "curl -fsSL https://get.docker.com | sudo sh   (tai aja ./scripts/install.sh, se tarjoaa asennusta)")"
elif ! docker compose version >/dev/null 2>&1; then
  bad "$(t "Docker Compose v2 is missing." "Docker Compose v2 puuttuu.")" "$(t "sudo apt install docker-compose-plugin   (or install Docker again: curl -fsSL https://get.docker.com | sudo sh)" "sudo apt install docker-compose-plugin   (tai asenna Docker uudelleen: curl -fsSL https://get.docker.com | sudo sh)")"
else
  ok "Docker $(docker --version 2>/dev/null | sed -E 's/Docker version ([^,]+),.*/\1/'), Compose $(docker compose version --short 2>/dev/null)"
  err=$(docker info 2>&1 >/dev/null | head -3)
  if docker info >/dev/null 2>&1; then
    DOCKER_OK=true
    ok "$(t "The Docker service responds (Docker $(docker version --format '{{.Server.Version}}' 2>/dev/null))" "Docker-palvelu vastaa (Docker $(docker version --format '{{.Server.Version}}' 2>/dev/null))")"
  elif [[ $err == *"permission denied"* ]]; then
    bad "$(t "User $(id -un) has no permission to use Docker." "Käyttäjällä $(id -un) ei ole oikeutta Dockeriin.")" "$(t "sudo usermod -aG docker \$USER   then log out and in (or run: newgrp docker)" "sudo usermod -aG docker \$USER   ja kirjaudu ulos ja sisään (tai aja: newgrp docker)")"
  else
    bad "$(t "The Docker service does not respond." "Docker-palvelu ei vastaa.")" "$(t "sudo systemctl start docker   (if that does not help: sudo journalctl -u docker -n 30)" "sudo systemctl start docker   (jos ei auta: sudo journalctl -u docker -n 30)")"
  fi
  if command -v systemctl >/dev/null && systemctl list-unit-files docker.service >/dev/null 2>&1 \
    && systemctl cat docker.service >/dev/null 2>&1; then
    state=$(systemctl is-enabled docker 2>/dev/null || true)
    if [[ $state == enabled ]]; then ok "$(t "Docker starts with the machine" "Docker käynnistyy koneen mukana")"
    else warn "$(t "Docker does not start at boot (state: ${state:-unknown}), so the app does not come back by itself." "Docker ei käynnisty koneen käynnistyessä (tila: ${state:-tuntematon}), sovellus ei palaa itsestään.")" "sudo systemctl enable docker"; fi
  fi
fi

# ── configuration ────────────────────────────────────────────────────────────
head_ "Settings" "Asetukset"
if [[ -f .env ]]; then
  PORT=$(env_val HOST_PORT); PORT=${PORT:-8080}
  BIND=$(env_val BIND_ADDRESS); BIND=${BIND:-127.0.0.1}
  URL=$(env_val APP_BASE_URL)
  ok "$(t ".env found (port $BIND:$PORT, address ${URL:-?})" ".env löytyy (portti $BIND:$PORT, osoite ${URL:-?})")"
  mode=$(stat -c %a .env 2>/dev/null || echo "")
  [[ -z $mode || $mode == 600 ]] || warn "$(t ".env has mode $mode and holds keys." ".env:n oikeudet ovat $mode, tiedostossa on avaimia.")" "chmod 600 .env"
else
  PORT=8080; BIND=127.0.0.1; URL=""
  warn "$(t "There is no .env in this folder, so nothing is installed here." "Kansiossa ei ole .env-tiedostoa, joten asennusta ei ole tehty tähän kansioon.")" "./scripts/install.sh"
fi

# ── container ────────────────────────────────────────────────────────────────
CID=""; RUNNING=false; IMAGE_ID=""
head_ "Container" "Sovellus"
if $DOCKER_OK; then
  CID=$(docker compose ps -a -q banking 2>/dev/null | head -1)
  if [[ -z $CID ]]; then
    bad "$(t "There is no container." "Sovellusta ei löydy Dockerista.")" "./scripts/install.sh"
  else
    IFS='|' read -r st health restarts started exitcode oom IMAGE_ID < <(docker inspect -f '{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{end}}|{{.RestartCount}}|{{.State.StartedAt}}|{{.State.ExitCode}}|{{.State.OOMKilled}}|{{.Image}}' "$CID" 2>/dev/null)
    up=$(( $(date +%s) - $(epoch "$started") ))
    case $st in
      running)
        RUNNING=true
        if [[ $restarts -ge 3 && $up -lt 600 ]]; then
          bad "$(t "The container keeps restarting ($restarts times, last $(span $up) ago)." "Sovellus käynnistyy yhä uudelleen ($restarts kertaa, viimeksi $(span $up) sitten).")" "docker compose logs --tail 40 banking" "$(t "If the fault began with an update: ./scripts/update.sh --rollback" "Jos vika alkoi päivityksestä: ./scripts/update.sh --rollback")"
        elif [[ $health == healthy ]]; then
          ok "$(t "The container is running and healthy (started $(span $up) ago)" "Sovellus käynnissä ja terve (käynnistetty $(span $up) sitten)")"
        elif [[ $health == starting ]]; then
          warn "$(t "The container is still starting (health check pending)." "Sovellus käynnistyy vielä (terveystarkistus kesken).")" "$(t "Wait a minute and run again. If that does not help: docker compose logs --tail 40 banking" "Odota minuutti ja aja uudelleen. Jos ei auta: docker compose logs --tail 40 banking")"
        elif [[ $health == unhealthy ]]; then
          bad "$(t "The container is running but the health check fails." "Sovellus käynnissä, mutta terveystarkistus epäonnistuu.")" "docker compose logs --tail 40 banking" "docker compose restart banking"
        else
          ok "$(t "The container is running (started $(span $up) ago)" "Sovellus käynnissä (käynnistetty $(span $up) sitten)")"
        fi
        if [[ $restarts -gt 0 && ! ($restarts -ge 3 && $up -lt 600) ]]; then
          warn "$(t "The container has restarted $restarts times (the machine or Docker restarted, or the app crashed)." "Sovellus on käynnistynyt uudelleen $restarts kertaa (kone tai Docker käynnistyi uudelleen, tai sovellus kaatui).")" "docker compose logs --tail 60 banking"
        fi
        ;;
      restarting)
        bad "$(t "The container keeps crashing and restarting ($restarts times)." "Sovellus kaatuu ja käynnistyy uudelleen koko ajan ($restarts kertaa).")" "docker compose logs --tail 40 banking" "$(t "If the fault began with an update: ./scripts/update.sh --rollback" "Jos vika alkoi päivityksestä: ./scripts/update.sh --rollback")" ;;
      *)
        extra=""; [[ $oom == true ]] && extra="$(t " (out of memory, add memory to the machine)" " (muisti loppui, nosta koneen muistia)")"
        bad "$(t "The container is not running (state $st, exit code $exitcode$extra)." "Sovellus ei ole käynnissä (tila $st, poistumiskoodi $exitcode$extra).")" "docker compose logs --tail 40 banking" "docker compose up -d" ;;
    esac
  fi
else
  warn "$(t "Skipped because Docker does not respond." "Ohitettu, koska Docker ei vastaa.")"
fi

# ── port ─────────────────────────────────────────────────────────────────────
head_ "Port" "Portti"
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
    ok "$(t "Port $PORT is bound to the container ($BIND)" "Portti $PORT on sidottu sovellukselle ($BIND)")"
  else
    bad "$(t "The container port does not match .env ($BIND:$PORT, container has: ${bound:-no port})." "Sovelluksen portti ei vastaa .env:n arvoa $BIND:$PORT (nyt: ${bound:-ei porttia}).")" "docker compose up -d --force-recreate banking"
  fi
fi
if $RUNNING; then
  http_ok "http://$PROBE:$PORT/api/health"; rc=$?
  if ((rc == 0)); then ok "$(t "The app responds at http://$PROBE:$PORT" "Sovellus vastaa osoitteessa http://$PROBE:$PORT")"
  elif ((rc == 2)); then warn "$(t "curl and wget are missing, so the answer cannot be tried from the machine." "curl ja wget puuttuvat, vastausta ei voi kokeilla koneelta.")" "sudo apt install curl"
  else
    holder=""
    command -v ss >/dev/null && holder=$(ss -H -ltnp "sport = :$PORT" 2>/dev/null | grep -v docker-proxy | head -1)
    if [[ -n $holder ]]; then bad "$(t "Another program holds port $PORT." "Portin $PORT on varannut jokin muu ohjelma.")" "$(t "ss -ltnp 'sport = :$PORT'   and choose another port: ./scripts/install.sh" "ss -ltnp 'sport = :$PORT'   ja valitse toinen portti: ./scripts/install.sh")"
    else bad "$(t "The app does not respond at http://$PROBE:$PORT." "Sovellus ei vastaa osoitteessa http://$PROBE:$PORT.")" "docker compose logs --tail 40 banking" "docker compose restart banking"; fi
  fi
fi

# ── volumes and disk ─────────────────────────────────────────────────────────
head_ "Volumes and disk" "Taltiot ja levy"
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
        ok "$(t "Volume ${proj}_$v${kb:+ ($(human_kb "$kb"))}" "Taltio ${proj}_$v${kb:+ ($(human_kb "$kb"))}")"
      else
        ok "$(t "Volume ${proj}_$v" "Taltio ${proj}_$v")"
      fi
    else
      bad "$(t "Volume ${proj}_$v does not exist. The data is missing or the name changed." "Taltiota ${proj}_$v ei ole. Tiedot puuttuvat tai nimi on muuttunut.")" "$(t "docker volume ls   and if needed restore a backup: docs/ADVANCED.md#backups" "docker volume ls   ja tarvittaessa palauta varmuuskopio: docs/ADVANCED.md#backups")"
    fi
  done
fi
disk() { # disk LABEL PATH
  local kb pct
  [[ -d $2 ]] || return 0
  read -r kb pct < <(df -Pk "$2" 2>/dev/null | awk 'NR==2 {gsub("%", "", $5); print $4, $5}')
  [[ -n ${kb:-} ]] || return 0
  if ((kb < 512 * 1024)); then bad "$(t "$1: only $(human_kb "$kb") free ($pct % used)." "$1: vapaata vain $(human_kb "$kb") ($pct % käytössä).")" "$(t "docker image prune -f; docker builder prune -f   and free some space; an update and a build need about 2 GB" "docker image prune -f; docker builder prune -f   ja tyhjennä tilaa; päivitys ja rakennus tarvitsevat noin 2 Gt")"
  elif ((kb < 2 * 1024 * 1024)); then warn "$(t "$1: $(human_kb "$kb") free ($pct % used), an update needs about 2 GB." "$1: vapaata $(human_kb "$kb") ($pct % käytössä), päivitys tarvitsee noin 2 Gt.")" "$(t "docker image prune -f   and docker builder prune -f" "docker image prune -f   ja docker builder prune -f")"
  else ok "$(t "$1: $(human_kb "$kb") free ($pct % used)" "$1: vapaata $(human_kb "$kb") ($pct % käytössä)")"; fi
}
disk "$(t "Disk (folder $ROOT)" "Levy (kansio $ROOT)")" "$ROOT"
if $DOCKER_OK; then
  root=$(docker info -f '{{.DockerRootDir}}' 2>/dev/null)
  [[ -n $root && $(df -P "$root" 2>/dev/null | awk 'NR==2 {print $1}') != $(df -P "$ROOT" | awk 'NR==2 {print $1}') ]] && disk "$(t "Disk (Docker data)" "Levy (Dockerin data)")" "$root"
fi

# ── backups ──────────────────────────────────────────────────────────────────
head_ "Backups" "Varmuuskopiot"
# a file that is empty, cut short or not a database is no backup (a full disk leaves such files)
backup_file_ok() { # backup_file_ok FILE
  local size
  size=$(stat -c %s "$1" 2>/dev/null) || return 1
  case $1 in
    *.gz) ((size >= 1024)) && gzip -t "$1" 2>/dev/null ;;
    *.age) ((size >= 200)) ;;
    *) ((size >= 4096)) && [[ $(head -c 15 "$1" 2>/dev/null) == "SQLite format 3" ]] ;;
  esac
}
newest=""; broken=()
while IFS= read -r f; do
  [[ -n $f ]] || continue
  if backup_file_ok "$f"; then [[ -n $newest ]] || newest=$f; else broken+=("$f"); fi
done < <(ls -1t backups/talous-*.db.gz backups/talous-*.db.gz.age backups/talous-*.db.age backups/talous-*.db 2>/dev/null)
if ((${#broken[@]})); then
  warn "$(t "${#broken[@]} file(s) in backups/ are not usable backups (empty, cut short or fail gzip -t): ${broken[*]}" "Kansiossa backups/ on varmuuskopioksi kelpaamattomia tiedostoja: ${#broken[@]} (tyhjä, katkennut tai ei läpäise gzip -t -tarkistusta): ${broken[*]}")" "$(t "rm the files, check the free disk space, run ./scripts/backup.sh again" "poista tiedostot, tarkista levytila ja aja ./scripts/backup.sh uudelleen")"
fi
if [[ -n $newest ]]; then
  age=$(( $(date +%s) - $(stat -c %Y "$newest") ))
  if ((age > 3 * 86400)); then warn "$(t "The newest backup is $(span $age) old ($newest)." "Uusin varmuuskopio on $(span $age) vanha ($newest).")" "$(t "./scripts/backup.sh   and schedule it: docs/ADVANCED.md#backups" "./scripts/backup.sh   ja ajasta se: docs/ADVANCED.md#backups")"
  else ok "$(t "The newest backup is $(span $age) old ($newest)" "Uusin varmuuskopio $(span $age) vanha ($newest)")"; fi
else
  warn "$(t "The backups/ folder has no usable backups." "Kansiossa backups/ ei ole käyttökelpoisia varmuuskopioita.")" "$(t "./scripts/backup.sh   and schedule it: docs/ADVANCED.md#backups" "./scripts/backup.sh   ja ajasta se: docs/ADVANCED.md#backups")"
fi
if $DOCKER_OK && { $RUNNING || docker image inspect "$APP_IMAGE" >/dev/null 2>&1; }; then
  # every copy of the app is opened and checked; a file that fails is listed (the app removes new ones itself)
  auto=$(in_vol node --disable-warning=ExperimentalWarning -e '
    const fs = require("node:fs");
    const { DatabaseSync } = require("node:sqlite");
    const ok = (p) => {
      try {
        if (fs.statSync(p).size < 4096) return false;
        const d = new DatabaseSync(p, { readOnly: true });
        try { const q = d.prepare("PRAGMA quick_check(1)").all(); return q.length === 1 && q[0].quick_check === "ok" && !!d.prepare("SELECT 1 FROM sqlite_master WHERE name = ?").get("users"); } finally { d.close(); }
      } catch { return false; }
    };
    try {
      const all = fs.readdirSync("/data/backups").filter((n) => /\.db$/.test(n)).map((n) => ({ n, good: ok("/data/backups/" + n), t: fs.statSync("/data/backups/" + n).mtimeMs / 1000 }));
      const auto = all.filter((f) => f.good && /^auto-/.test(f.n)).sort((a, b) => b.t - a.t);
      const bad = all.filter((f) => !f.good).map((f) => f.n);
      console.log(auto.length + " " + Math.floor(auto[0]?.t ?? 0) + " " + (bad.join(",") || "-"));
    } catch { console.log("0 0 -"); }' | tail -1)
  read -r acount atime abroken <<<"${auto:-0 0 -}"
  if [[ ${abroken:--} != - ]]; then
    warn "$(t "The volume has database copies that fail their check: ${abroken//,/ }" "Taltiossa on tietokantakopioita, jotka eivät läpäise tarkistusta: ${abroken//,/ }")" "$(t "docker compose exec banking rm /data/backups/<file>   then check the free disk space" "docker compose exec banking rm /data/backups/<tiedosto>   ja tarkista levytila")"
  fi
  if [[ ${acount:-0} -gt 0 ]]; then
    aage=$(( $(date +%s) - atime ))
    if ((aage > 2 * 86400)); then warn "$(t "The app's own daily copy is $(span $aage) old ($acount in the volume)." "Sovelluksen oma päiväkopio on $(span $aage) vanha ($acount taltiossa).")" "docker compose logs banking | grep -i backup"
    else ok "$(t "The app's own daily copy is $(span $aage) old ($acount in the volume)" "Sovelluksen oma päiväkopio $(span $aage) vanha ($acount taltiossa)")"; fi
  else
    warn "$(t "The volume has no usable daily copy by the app yet (it appears within the first day)." "Taltiossa ei ole vielä sovelluksen käyttökelpoista päiväkopiota (tulee ensimmäisen vuorokauden aikana).")"
  fi
fi

# ── version ──────────────────────────────────────────────────────────────────
head_ "Version" "Versio"
if $RUNNING; then
  runv=$(docker compose exec -T banking node --disable-warning=ExperimentalWarning dist/node.js version 2>/dev/null | tail -1)
  srcv=$(sed -n 's/.*APP_VERSION = "\([^"]*\)".*/\1/p' apps/server/src/version.ts 2>/dev/null)
  if [[ -z $runv ]]; then warn "$(t "Could not read the app version." "Sovelluksen versiota ei saatu luettua.")" "docker compose logs --tail 20 banking"
  elif [[ -n $srcv && $runv != "$srcv "* ]]; then
    bad "$(t "Version $runv is running but the code in this folder is version $srcv." "Käynnissä on $runv, mutta kansion koodi on versio $srcv.")" "./scripts/update.sh"
  else ok "$(t "Running $runv" "Käynnissä $runv")"; fi
fi
if command -v git >/dev/null && git rev-parse --git-dir >/dev/null 2>&1; then
  head_c=$(git rev-parse HEAD 2>/dev/null)
  label=""
  [[ -n $IMAGE_ID ]] && label=$(docker image inspect -f '{{index .Config.Labels "talous.commit"}}' "$IMAGE_ID" 2>/dev/null)
  if [[ -z $label || $label == unknown ]]; then
    $RUNNING && warn "$(t "The build commit of the image is unknown (built without the update script), the code in this folder is $(git rev-parse --short HEAD)." "Käynnissä olevan version lähdekoodia ei tiedetä (tehty ilman päivitysskriptiä), kansion koodi on $(git rev-parse --short HEAD).")" "./scripts/update.sh"
  elif [[ $label != "$head_c" ]]; then
    bad "$(t "The image was built from ${label:0:7}, the folder has ${head_c:0:7}." "Käynnissä oleva versio on tehty koodista ${label:0:7}, kansiossa on ${head_c:0:7}.")" "./scripts/update.sh"
  else ok "$(t "The image matches the code in this folder (${head_c:0:7})" "Käynnissä oleva versio vastaa kansion koodia (${head_c:0:7})")"; fi
  if [[ -n $(git status --porcelain --untracked-files=no 2>/dev/null) ]]; then
    warn "$(t "The folder has local changes, update.sh does not run with them." "Asennuskansion tiedostoja on muutettu käsin, joten päivitys ei toimi.")" "git status"
  fi
  upstream=$(git rev-parse '@{u}' 2>/dev/null || true)
  if [[ -n $upstream && $upstream != "$head_c" ]]; then
    n=$(git rev-list --count "HEAD..$upstream" 2>/dev/null || echo "?")
    [[ $n != 0 ]] && warn "$(t "The remote repository may have $n new changes (going by what was last fetched)." "Päivityslähteessä voi olla $n uutta muutosta (viimeksi haetun tiedon mukaan).")" "./scripts/update.sh"
  fi
fi

# ── log ──────────────────────────────────────────────────────────────────────
head_ "Log" "Loki"
if $DOCKER_OK && [[ -n $CID ]]; then
  errs=$(docker compose logs --no-color --tail 300 banking 2>&1 | grep -iE 'error|fatal|exception|database was upgraded by a newer|Could not open the database|uncaught|ENOSPC|SQLITE' | tail -5 | scrub)
  if [[ -n $errs ]]; then
    warn "$(t "Latest errors in the log (sensitive parts hidden):" "Lokin viimeisimmät virheet (arkaluontoinen osa piilotettu):")"
    while IFS= read -r l; do printf '      %s\n' "$l"; done <<<"$errs"
    printf '    %s→ docker compose logs --tail 100 banking%s\n' "$dim" "$reset"
  else ok "$(t "No errors in the log" "Lokissa ei näy virheitä")"; fi
fi

# ── address ──────────────────────────────────────────────────────────────────
head_ "Address" "Osoite"
if [[ -n $URL ]]; then
  if [[ $URL == http://localhost* || $URL == http://127.* ]]; then
    ok "$(t "Address $URL is for this machine only" "Osoite $URL on vain tälle koneelle")"
  else
    http_ok "$URL/api/health" >/dev/null 2>&1; rc=$?
    if ((rc == 0)); then ok "$(t "Address $URL responds" "Osoite $URL vastaa")"
    elif ((rc == 2)); then warn "$(t "The address cannot be tried without curl." "Osoitetta ei voi kokeilla ilman curlia.")" "sudo apt install curl"
    else
      case $URL in
        https://*) hint="$(t "DNS, forwarding of ports 80 and 443 and the certificate: docker compose logs caddy   (or the tunnel status in Cloudflare)" "DNS, porttien 80 ja 443 ohjaus ja sertifikaatti: docker compose logs caddy   (tai tunnelin tila Cloudflaressa)")" ;;
        *) hint="$(t "whether the address is the machine's own and port $PORT is open in the home network" "onko osoite koneen oma ja portti $PORT auki kotiverkossa")" ;;
      esac
      warn "$(t "Address $URL does not respond from this machine." "Osoite $URL ei vastaa tältä koneelta.")" "$hint" "$(t "If the address works from elsewhere, the machine may not reach its own public address." "Jos osoite toimii muualta, kone ei ehkä yllä omaan julkiseen osoitteeseensa.")"
    fi
  fi
else
  warn "$(t "No address is set in .env." "Osoitetta ei ole asetettu .env-tiedostossa.")" "./scripts/install.sh"
fi

# ── home network address ─────────────────────────────────────────────────────
host_addr_list() { ip -4 -o addr show 2>/dev/null | awk '{split($4, a, "/"); print a[1]}'; }
if [[ -f .env && -n ${BIND:-} && $BIND != 127.0.0.1 && $BIND != localhost && $BIND != 0.0.0.0 && $BIND != "::" ]] && command -v ip >/dev/null; then
  head_ "Home network address" "Kotiverkon osoite"
  if host_addr_list | grep -qxF "$BIND"; then
    ok "$(t "The machine has the address $BIND" "Koneella on osoite $BIND")"
    urlhost=${URL#*://}; urlhost=${urlhost%%/*}; urlhost=${urlhost%:*}
    if [[ -n $URL && $urlhost != "$BIND" ]]; then
      warn "$(t "Address $URL differs from the listen address $BIND." "Osoite $URL ei ole sama kuin kuunteluosoite $BIND.")" "$(t "Update the address: Asetukset > Palvelin, or run ./scripts/install.sh --reconfigure" "Päivitä osoite: Asetukset > Palvelin, tai aja ./scripts/install.sh --reconfigure")"
    fi
  else
    warn "$(t "The machine no longer has the address $BIND (did the router's DHCP give a new one?), so the app may be unreachable." "Koneella ei ole enää osoitetta $BIND, joten sovellus ei ehkä ole tavoitettavissa. Reititin on voinut antaa uuden osoitteen.")" \
      "$(t "Reserve a fixed address for the machine in the router and run ./scripts/install.sh --reconfigure" "Varaa koneelle kiinteä osoite reitittimestä ja aja ./scripts/install.sh --reconfigure")" \
      "$(t "If the container does not start at boot because the address does not exist yet: sudo sysctl -w net.ipv4.ip_nonlocal_bind=1" "Jos sovellus ei käynnisty koneen käynnistyessä, kun osoite ei ole vielä olemassa: sudo sysctl -w net.ipv4.ip_nonlocal_bind=1")"
  fi
fi

# ── maintenance helper ───────────────────────────────────────────────────────
head_ "Maintenance helper" "Ylläpitoapuri"
# the helper's safety paths and the user manager's groups: the same code the installer uses
# shellcheck source=lib/ops-schedule.sh
. ./scripts/lib/ops-schedule.sh
UNIT="talous-ops-$INSTANCE"
HELPER_KIND=""; perm_bad=""
if command -v systemctl >/dev/null && systemctl --user is-enabled "$UNIT.timer" >/dev/null 2>&1; then HELPER_KIND=systemd
elif command -v crontab >/dev/null && crontab -l 2>/dev/null | grep -qE " # talous-ops:$INSTANCE\$"; then HELPER_KIND=cron; fi
if [[ -z $HELPER_KIND ]]; then
  warn "$(t "The maintenance helper is not enabled, so updates and backups cannot be done from the browser." "Ylläpitoapuri ei ole käytössä, joten päivitys ja varmuuskopio eivät onnistu selaimesta.")" "./scripts/install.sh --ops-helper"
elif [[ $(id -u) -eq 0 ]]; then
  # the helper refuses to run as root, so waiting for it would never end
  warn "$(t "The maintenance helper is scheduled for root ($HELPER_KIND), and it does not run as root." "Ylläpitoapuri on ajastettu pääkäyttäjälle ($HELPER_KIND), mutta se ei toimi pääkäyttäjänä.")" "$(t "Remove it: ./scripts/install.sh --ops-helper-off   and install it again as a normal user: ./scripts/install.sh --ops-helper" "Poista: ./scripts/install.sh --ops-helper-off   ja asenna uudelleen tavallisella käyttäjällä: ./scripts/install.sh --ops-helper")"
else
  ok "$(t "The maintenance helper is scheduled ($HELPER_KIND)" "Ylläpitoapuri ajastettu ($HELPER_KIND)")"
  # the helper refuses to run when someone else owns the clone, .git, scripts or .env, or others can write to them
  perm_bad=$(ops_unsafe_paths)
  if [[ -n $perm_bad ]]; then
    perm_n=$(printf '%s\n' "$perm_bad" | wc -l); perm_first=$(printf '%s\n' "$perm_bad" | head -n 1)
    perm_fix="./scripts/install.sh --ops-helper"
    for p in $perm_bad; do [[ $(stat -c %u "$p" 2>/dev/null) == "$(id -u)" ]] || perm_fix="sudo chown -R $(id -un) .   $(t "and then:" "ja sitten:") $perm_fix"; done
    warn "$(t "The helper does not run: file permissions are not safe ($perm_first$( ((perm_n > 1)) && echo ", and $((perm_n - 1)) more"))." "Apuri ei käynnisty: tiedostojen oikeudet eivät kelpaa ($perm_first$( ((perm_n > 1)) && echo ", ja $((perm_n - 1)) muuta")).")" "$(t "Others can write to them or they belong to someone else. Run: $perm_fix" "Muut voivat kirjoittaa niihin tai ne ovat jonkun muun. Aja: $perm_fix")"
  fi
  # a user manager that started before the user joined the docker group runs the timer without Docker
  if [[ $HELPER_KIND == systemd ]] && ops_manager_lacks_docker; then
    warn "$(t "The systemd user manager started before this user joined the docker group, so the helper's timer cannot use Docker." "Käyttäjän systemd käynnistyi ennen kuin käyttäjä liitettiin docker-ryhmään, joten apurin ajastin ei pääse käyttämään Dockeria.")" "$(t "sudo systemctl restart user@$(id -u).service   or reboot the machine" "sudo systemctl restart user@$(id -u).service   tai käynnistä kone uudelleen")"
  fi
  if [[ -f ops/helper-seen ]]; then
    hage=$(( $(date +%s) - $(stat -c %Y ops/helper-seen) ))
    if ((hage < 300)); then ok "$(t "The helper last ran $(span $hage) ago" "Apuri on käynyt $(span $hage) sitten")"
    else warn "$(t "The helper has not run for $(span $hage)." "Apuri ei ole käynyt $(span $hage) aikaan.")" "$([[ $HELPER_KIND == systemd ]] && echo "$(t "systemctl --user status $UNIT.timer   and: journalctl --user -u $UNIT.service -n 20" "systemctl --user status $UNIT.timer   ja: journalctl --user -u $UNIT.service -n 20")" || echo "tail -n 20 ops/helper.log")"; fi
  else
    warn "$(t "The helper has not run yet." "Apuri ei ole vielä käynyt.")" "$(t "Wait a minute and run this again. If that does not help: ./scripts/ops-helper.sh" "Odota minuutti ja aja tämä uudelleen. Jos ei auta: ./scripts/ops-helper.sh")"
  fi
  if [[ $HELPER_KIND == systemd ]] && command -v loginctl >/dev/null && [[ $(loginctl show-user "$(id -un)" -p Linger --value 2>/dev/null) == no ]]; then
    warn "$(t "User services do not start at boot (linger is off), so the helper works only after a login." "Käyttäjän palvelut eivät käynnisty koneen käynnistyessä (linger pois), apuri toimii vasta kirjautumisen jälkeen.")" "sudo loginctl enable-linger $(id -un)"
  fi
fi
if [[ -n $HELPER_KIND && ! -f ops/allowed_signers ]] && grep -qE '^TALOUS_CHANNEL=source$' .env 2>/dev/null; then
  warn "$(t "Updates are not signed: the source channel trusts everyone who can write to the main branch." "Päivityksiä ei tarkisteta allekirjoituksella: lähdekanava luottaa jokaiseen, jolla on kirjoitusoikeus päivityslähteeseen.")" "$(t "The release channel checks the signature itself (remove TALOUS_CHANNEL=source from .env), or add keys to ops/allowed_signers (docs/SECURITY.md)" "Julkaisukanava tarkistaa allekirjoituksen itse (poista TALOUS_CHANNEL=source tiedostosta .env), tai lisää avaimet tiedostoon ops/allowed_signers (docs/SECURITY.md)")"
fi
if [[ -f ops/RECOVERY.txt ]]; then
  bad "$(t "The update failed and the rollback failed too." "Päivitys epäonnistui eikä palautus onnistunut.")" "cat ops/RECOVERY.txt"
fi
# A refusal in the log counts until a tick passes the checks (the helper then writes ops/helper-seen, a timestamp in the
# log's own format). The permission refusals are said above when they still hold.
refusals='File permissions|\.env is invalid'; [[ -z $perm_bad ]] || refusals='\.env is invalid'
refusal=$(tail -n 20 ops/helper.log 2>/dev/null | grep -E "$refusals" | tail -1)
if [[ -n $refusal && ${refusal%% *} > $(cat ops/helper-seen 2>/dev/null) ]]; then
  warn "$(t "The helper refuses to run: $(printf '%s' "$refusal" | cut -d' ' -f2- | scrub)" "Apuri kieltäytyy toimimasta, syy on lokissa.")" "tail -n 20 ops/helper.log"
fi

# ── JSON ─────────────────────────────────────────────────────────────────────
if $JSON; then
  printf '{"at":"%s","items":[%s]}\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$ITEMS" >&3
  exit 0
fi

# ── verdict ──────────────────────────────────────────────────────────────────
printf '\n'
if ((PROBLEMS > 0)); then
  printf '%s✗ %d problem(s)%s%s. Fix them from the top and run ./scripts/doctor.sh again.\n' "$red" "$PROBLEMS" "$reset" "$( ((WARNINGS)) && echo ", $WARNINGS warning(s)" )"
  exit 1
elif ((WARNINGS > 0)); then
  printf '%s! No problems, %d warning(s).%s\n' "$yellow" "$WARNINGS" "$reset"
  exit 2
fi
printf '%s✓ All well.%s\n' "$green" "$reset"
