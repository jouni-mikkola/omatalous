# shellcheck shell=bash
# shellcheck disable=SC2154,SC2034  # the installer's variables (colours, current_profile, RESUMED) are set and read in install.sh
# The Cloudflare part of install.sh (sourced, not run): with --access tunnel and the file
# ~/.config/omatalous/cloudflare.env (mode 600: CLOUDFLARE_API_TOKEN, CLOUDFLARE_BASE_DOMAIN and, as the default list
# of every copy, CLOUDFLARE_ACCESS_EMAILS) the installer has Cloudflare make the tunnel, its address and the Access rule.
# A copy from --new-instance gets <name>.<base domain>; a first install is asked (talous.<base domain> by default) and
# with --yes needs --domain. A host that is not this copy's yet is asked for with `cloudflare up --new`, which stops
# when another copy (a second folder or machine with the same file) has it. The copy's own list of
# emails is kept in its .env (CLOUDFLARE_ACCESS_EMAILS); --access-emails changes it later. Without the file, or with
# TALOUS_TUNNEL_TOKEN, the tunnel is the one made by hand in the dashboard. --cloudflare-down removes what was made.
# What Cloudflare answers also turns on the app's own check of Access (cf_access_from and cf_up below).
#
# The file holds an API token, so it is read by this user only. It is parsed, never sourced, and its values reach the
# app image's command through the environment of docker run, never through an argument list (ps shows those).
# Uses the installer's globals and helpers (die, say, ask, existing, valid_domain, A_*, ACCESS, DOMAIN, ...).

CF_FILE="${HOME:-/nonexistent}/.config/omatalous/cloudflare.env"
CF_API_TOKEN=""; CF_EMAILS=""; CF_BASE=""
ACCESS_EMAILS=""   # the emails Access lets in for this copy: .env CLOUDFLARE_ACCESS_EMAILS, by default the file's list
CF_AUTO=false      # this run asks Cloudflare for the tunnel
CF_NEW=false       # the host is not this copy's yet (cf_mine): `up --new`, and .env says CLOUDFLARE_NEW_HOST until it worked

# norm_emails LIST: prints the addresses of a comma-separated list, trimmed and joined by commas. A plain address check,
# at least one. On a bad list it prints the reason instead and fails.
norm_emails() {
  local rest=$1 e list=""
  while [[ -n $rest ]]; do
    e=${rest%%,*}; if [[ $rest == *,* ]]; then rest=${rest#*,}; else rest=""; fi
    e=${e#"${e%%[![:space:]]*}"}; e=${e%"${e##*[![:space:]]}"}
    [[ -n $e ]] || continue
    [[ $e =~ ^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$ ]] || { printf 'not an email address: %s' "$e"; return 1; }
    list+="${list:+,}$e"
  done
  [[ -n $list ]] || { printf 'no email address given'; return 1; }
  printf '%s' "$list"
}

# cf_load: 1 = there is no file, 0 = it was read. A file that others can read, change or swap, or that is not complete,
# stops the install. The file is opened once and its mode, owner and lines all come from that open file, so a swap of
# the path after the check changes nothing; the folders above it must not let others swap it either.
cf_load() {
  [[ -e $CF_FILE || -L $CF_FILE ]] || return 1
  local fd dir mode owner kind line key val me
  me=$(id -u)
  for dir in "${CF_FILE%/*/*}" "${CF_FILE%/*}"; do
    read -r mode owner < <(stat -L -c '%a %u' -- "$dir" 2>/dev/null || true)
    [[ $mode =~ ^[0-7]+$ ]] || die "Cannot read the permissions of $dir."
    ((8#$mode & 8#022)) && die "$dir can be changed by others (mode $mode), so they could swap $CF_FILE, which holds an API token. Run: chmod go-w $dir"
    [[ $owner == "$me" || $owner == 0 ]] || die "$dir belongs to someone else, who could swap $CF_FILE. It must belong to the user who runs the install: sudo chown $(id -un) $dir"
  done
  [[ ! -L $CF_FILE ]] || die "$CF_FILE is a link. It holds an API token, so it must be a plain file of its own: replace the link with the file, then chmod 600 $CF_FILE"
  [[ -f $CF_FILE ]] || die "$CF_FILE is not a plain file."
  exec {fd}<"$CF_FILE" || die "Cannot read $CF_FILE."
  # the open file is the plain file at the path (a link put there meanwhile has another inode), and its own mode and owner
  read -r mode owner kind < <(stat -L -c '%a %u %d:%i:%F' "/dev/fd/$fd" 2>/dev/null || true)
  [[ ${kind#*:*:} == "regular file" || ${kind#*:*:} == "regular empty file" ]] || die "$CF_FILE is not a plain file."
  [[ ! -L $CF_FILE && $(stat -c %d:%i -- "$CF_FILE" 2>/dev/null) == "${kind%:*}" ]] || die "$CF_FILE changed while it was read. Run this again."
  [[ $mode =~ ^[0-7]+$ ]] || die "Cannot read the permissions of $CF_FILE."
  ((8#$mode & 8#077)) && die "$CF_FILE can be read by others (mode $mode) and it holds an API token. Run: chmod 600 $CF_FILE"
  [[ $owner == "$me" ]] || die "$CF_FILE belongs to someone else. It must belong to the user who runs the install: sudo chown $(id -un) $CF_FILE"
  CF_API_TOKEN=""; CF_EMAILS=""; CF_BASE=""
  while IFS= read -r -u "$fd" line || [[ -n $line ]]; do
    line=${line%$'\r'}
    [[ $line =~ ^[[:space:]]*(export[[:space:]]+)?(CLOUDFLARE_API_TOKEN|CLOUDFLARE_ACCESS_EMAILS|CLOUDFLARE_BASE_DOMAIN)[[:space:]]*=(.*)$ ]] || continue
    key=${BASH_REMATCH[2]}; val=${BASH_REMATCH[3]}
    val=${val#"${val%%[![:space:]]*}"}; val=${val%"${val##*[![:space:]]}"}
    if [[ $val == \"*\" || $val == \'*\' ]]; then val=${val:1:${#val}-2}; fi
    case $key in
      CLOUDFLARE_API_TOKEN) CF_API_TOKEN=$val ;;
      CLOUDFLARE_ACCESS_EMAILS) CF_EMAILS=$val ;;
      CLOUDFLARE_BASE_DOMAIN) CF_BASE=${val,,} ;;
    esac
  done
  exec {fd}<&-
  [[ -n $CF_API_TOKEN ]] || die "CLOUDFLARE_API_TOKEN is missing in $CF_FILE."
  [[ $CF_API_TOKEN =~ ^[A-Za-z0-9._-]+$ ]] || die "CLOUDFLARE_API_TOKEN in $CF_FILE has characters an API token does not have."
  # the emails in the file are only the default list of a copy, so they may be left out
  if [[ -n $CF_EMAILS ]]; then val=$(norm_emails "$CF_EMAILS") || die "CLOUDFLARE_ACCESS_EMAILS in $CF_FILE: $val"; CF_EMAILS=$val; fi
  [[ -n $CF_BASE ]] || die "CLOUDFLARE_BASE_DOMAIN is missing in $CF_FILE (a domain that is on your Cloudflare account, for example example.fi)."
  valid_domain "$CF_BASE" || die "CLOUDFLARE_BASE_DOMAIN in $CF_FILE is not a domain: $CF_BASE"
}

# cf_run up|down NAME HOST [--new]: the app image's cloudflare command with no database. Stdout is the command's (for up
# a JSON line with the tunnel token, so no log driver of the daemon, journald or syslog, may keep it), stderr is for people.
cf_run() {
  CLOUDFLARE_API_TOKEN=$CF_API_TOKEN CLOUDFLARE_ACCESS_EMAILS=$ACCESS_EMAILS \
    docker run --rm --log-driver none -e CLOUDFLARE_API_TOKEN -e CLOUDFLARE_ACCESS_EMAILS "$INSTANCE:latest" node dist/node.js cloudflare "$1" --name "$2" --hostname "$3" ${4:+"$4"}
}

# cf_mine HOST: 0 when Cloudflare's host HOST is this copy's: its .env has it as the tunnel's DOMAIN, Cloudflare made it
# (the copy's emails are there) and no run left it unfinished (CLOUDFLARE_NEW_HOST). Any other host is asked for with
# `up --new`, which Cloudflare refuses when another copy (a second folder or machine with the same file) has it.
cf_mine() {
  [[ $1 == "$(existing DOMAIN)" && $(existing COMPOSE_PROFILES) == tunnel && -n $(existing CLOUDFLARE_ACCESS_EMAILS) && $(existing CLOUDFLARE_NEW_HOST) != "$1" ]]
}

# cf_fail RC: the install stops with what to do about the command's exit code (its own lines are above)
cf_fail() {
  case $1 in
    2) die "Cloudflare setup was given input it does not accept (see above). Check the name and the address, then run this again." ;;
    3) die "Cloudflare refused (see above). The API token in $CF_FILE needs the permissions listed in docs/ADVANCED.md (Cloudflare Tunnel). Fix that and run this again." ;;
    4) die "Zero Trust is not on for this Cloudflare account. Turn on Zero Trust (the Free plan) in the Cloudflare dashboard, then run this again." ;;
    *) die "Cloudflare setup failed (exit $1, see above). Run this again. If the error comes back: ./scripts/doctor.sh" ;;
  esac
}

# env_set ITEM...: KEY=VALUE replaces the line KEY=... in .env (or adds it), a bare KEY removes it. Every item goes in
# with one rename, so a stop leaves all of them or none: half an Access pair is a .env the app refuses to start with
# (platform/config.ts). Only builtins see the values.
env_set() {
  local line item key mine found=" "
  umask 077
  {
    while IFS= read -r line || [[ -n $line ]]; do
      mine=""
      for item in "$@"; do
        key=${item%%=*}
        [[ $line == "$key="* ]] || continue
        mine=$key
        [[ $item != *=* ]] || { printf '%s\n' "$item"; found+="$key "; }
        break
      done
      [[ -n $mine ]] || printf '%s\n' "$line"
    done <"$ENV_FILE"
    for item in "$@"; do
      [[ $item != *=* || $found == *" ${item%%=*} "* ]] || printf '%s\n' "$item"
    done
  } >"$ENV_FILE.new"
  chmod 600 "$ENV_FILE.new"; mv -f "$ENV_FILE.new" "$ENV_FILE"
}

# The pair CF_ACCESS_AUD and CF_ACCESS_TEAM_DOMAIN in .env turns on the app's own check of Cloudflare Access
# (docs/SECURITY.md): the Access application's audience tag and the team's host. Both lines or neither.
# cf_access_from LINE: prints "AUD TEAM" from the JSON line of `cloudflare up`, each value only in the form the app
# accepts at start (platform/config.ts). Prints nothing unless the line has both: half a pair is no pair.
cf_access_from() {
  local aud="" team=""
  [[ $1 =~ \"accessAud\":\"([0-9a-f]{64})\" ]] && aud=${BASH_REMATCH[1]}
  [[ $1 =~ \"teamDomain\":\"([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.cloudflareaccess\.com)\" ]] && team=${BASH_REMATCH[1]}
  [[ -z $aud || -z $team ]] || printf '%s %s' "$aud" "$team"
}
# cf_access_kept: the lines of the pair that a rewrite of .env carries over. Only a tunnel made by hand whose address
# stays keeps them: its user wrote the pair, and dropping it would turn the check off without a word. Where Cloudflare
# makes the tunnel, cf_up writes the pair from its answer, and every other way in has no Access and gets no pair.
cf_access_kept() {
  local key value
  [[ $ACCESS == 3 ]] && ! $CF_AUTO && [[ $DOMAIN == "$(existing DOMAIN)" ]] || return 0
  for key in CF_ACCESS_AUD CF_ACCESS_TEAM_DOMAIN; do
    value=$(existing "$key"); [[ -z $value ]] || printf '%s=%s\n' "$key" "$value"
  done
}

# the host label of a copy: its name with the underscores a host name does not allow turned into hyphens
cf_label() { local l=${1//_/-}; l=${l#-}; printf '%s' "${l%-}"; }

# --access-emails alone means the tunnel, but not by switching an install that no tunnel reaches
cf_guard_emails() {
  [[ -z $A_ACCESS_EMAILS || ! -f $ENV_FILE || $current_profile == tunnel ]] ||
    die "--access-emails changes who Cloudflare Access lets in, and this install is not reached by a tunnel. To switch: ./scripts/install.sh --access tunnel --access-emails ..."
}

# The tunnel choice (access menu 3): the address and the emails, either for Cloudflare to make (the file) or by hand.
# The image does not exist yet, so Cloudflare is asked later (cf_up). Sets DOMAIN, TUNNEL_TOKEN, ACCESS_EMAILS and CF_AUTO.
cf_tunnel() {
  local def
  if [[ -z $A_TOKEN ]] && cf_load; then   # a token given by hand means a tunnel made by hand
    CF_AUTO=true
    # a copy made with --new-instance gets its own address without a question; the others are asked
    if [[ -n $A_DOMAIN ]]; then DOMAIN=$A_DOMAIN
    elif $FROM_CLONE && ! $EXISTING; then DOMAIN="$(cf_label "$INSTANCE").$CF_BASE"; say "Address of this copy: ${bold}$DOMAIN${reset}"
    # a later --access-emails in a copy's folder keeps its address
    elif $EXISTING && ! $RECONFIGURE && [[ $current_profile == tunnel && -n $(existing DOMAIN) ]]; then DOMAIN=$(existing DOMAIN)
    else
      def=$(existing DOMAIN)
      # --yes does not pick talous.<base domain> by itself: another folder or machine with the same file may have it
      [[ -n $def ]] || ! $YES || die "Give this copy's public address with --domain (for example --domain talous.$CF_BASE). With --yes the installer does not pick one: another copy with the same $CF_FILE may have it."
      ask DOMAIN "Public address of the app (Cloudflare makes it)" "${def:-talous.$CF_BASE}"
    fi
    DOMAIN=${DOMAIN,,}
    valid_domain "$DOMAIN" || die "Invalid domain: $DOMAIN"
    if cf_mine "$DOMAIN"; then CF_NEW=false; else CF_NEW=true; fi
    # who Access lets in is a list of this copy: the answer, else the one in this copy's .env, else the file's
    def=$(existing CLOUDFLARE_ACCESS_EMAILS)
    ask ACCESS_EMAILS "Email addresses Access lets in (comma-separated)" "${def:-$CF_EMAILS}" "$A_ACCESS_EMAILS"
    [[ -n $ACCESS_EMAILS ]] || die "No email address for Cloudflare Access. Give the addresses: --access-emails you@example.com,other@example.com   (or put CLOUDFLARE_ACCESS_EMAILS in $CF_FILE as the default)"
    def=$(norm_emails "$ACCESS_EMAILS") || die "The email addresses for Cloudflare Access: $def"
    ACCESS_EMAILS=$def
    say "  ${dim}Cloudflare makes the tunnel, the address and the Access rule from $CF_FILE after the build.${reset}"
    TUNNEL_TOKEN=""
  else
    [[ -z $A_ACCESS_EMAILS ]] || warn "--access-emails is used only when Cloudflare makes the tunnel (the file $CF_FILE). Set the Access rule in the dashboard."
    ask DOMAIN "Public address of the tunnel (for example talous.example.com)" "$(existing DOMAIN)" "$A_DOMAIN"
    [[ -n $DOMAIN ]] || die "The domain is missing. Give it with: --domain talous.example.com"
    valid_domain "$DOMAIN" || die "Invalid domain: $DOMAIN"
    say "  ${dim}Zero Trust > Networks > Tunnels > Create tunnel, copy the token (starts with eyJ…)${reset}"
    TUNNEL_TOKEN=$A_TOKEN
    if [[ -z $TUNNEL_TOKEN ]] && ! $YES; then ask_secret TUNNEL_TOKEN "Tunnel token (hidden, Enter = keep the current one)"; fi
    TUNNEL_TOKEN=${TUNNEL_TOKEN:-$(existing CLOUDFLARE_TUNNEL_TOKEN)}
    [[ -n $TUNNEL_TOKEN ]] || die "The tunnel token is missing. Give it in the environment: TALOUS_TUNNEL_TOKEN=eyJ… ./scripts/install.sh --yes --access tunnel --domain ..."
    [[ $TUNNEL_TOKEN =~ ^[A-Za-z0-9._=-]+$ ]] || die "The token is missing or invalid."
  fi
}

# cf_up: after the build and before the containers start. Has Cloudflare make (or confirm) the tunnel, the address and the
# Access rule, then puts the tunnel token in .env, and with it the pair for the app's own check of Access. Also finishes
# a run that stopped here before: .env then holds the address and the copy's emails but no token (the run is "resumed",
# which the installer needs to know).
cf_up() {
  local out rc=0 token changed="" aud="" team=""
  if ! $CF_AUTO; then
    [[ $KEEP_ALL == true && $ACCESS == 3 && -z $TUNNEL_TOKEN && -n $DOMAIN ]] && cf_load || return 0
    ACCESS_EMAILS=$(existing CLOUDFLARE_ACCESS_EMAILS); ACCESS_EMAILS=${ACCESS_EMAILS:-$CF_EMAILS}
    [[ -n $ACCESS_EMAILS ]] || die "No email address for Cloudflare Access. Give the addresses: ./scripts/install.sh --access-emails you@example.com"
    CF_AUTO=true; RESUMED=true
    if cf_mine "$DOMAIN"; then CF_NEW=false; else CF_NEW=true; fi
  fi
  step "Cloudflare"
  say "Making the tunnel, the address and the Access rule for $DOMAIN."
  if $CF_NEW; then out=$(cf_run up "$INSTANCE" "$DOMAIN" --new) || rc=$?; else out=$(cf_run up "$INSTANCE" "$DOMAIN") || rc=$?; fi
  if ((rc == 3)) && $CF_NEW; then
    die "Cloudflare refused (see above). If $DOMAIN is already set up there, it may be another copy's (another folder or machine with the same $CF_FILE) and was left as it is: give this copy its own address with --domain. Otherwise the API token in $CF_FILE needs the permissions listed in docs/ADVANCED.md (Cloudflare Tunnel)."
  fi
  ((rc == 0)) || cf_fail "$rc"
  out=${out##*$'\n'}   # the JSON line is the last (and only) line of stdout
  [[ $out =~ \"tunnelToken\":\"([A-Za-z0-9._=+/-]+)\" ]] || die "Cloudflare answered without a tunnel token. Run this again. If the error comes back: ./scripts/doctor.sh"
  token=${BASH_REMATCH[1]}
  [[ $out =~ \"changed\":\[([^]]*)\] ]] && changed=${BASH_REMATCH[1]//\"/}
  read -r aud team <<<"$(cf_access_from "$out")" || true
  # the host is this copy's from here on (first, so a stop before the token leaves a run that finishes without --new)
  ! $CF_NEW || env_set CLOUDFLARE_NEW_HOST
  # the pair goes in with the token, or off with it (the app then runs without the check): .env never holds half a
  # pair, or a token whose tunnel would run without the check while a plain re-run asks Cloudflare nothing
  if [[ -n $aud && -n $team ]]; then env_set "CF_ACCESS_AUD=$aud" "CF_ACCESS_TEAM_DOMAIN=$team" "CLOUDFLARE_TUNNEL_TOKEN=$token"
  else env_set CF_ACCESS_AUD CF_ACCESS_TEAM_DOMAIN "CLOUDFLARE_TUNNEL_TOKEN=$token"; fi
  TUNNEL_TOKEN=$token
  if [[ -n $changed ]]; then ok "Cloudflare changed: ${changed//,/, }."; else ok "Cloudflare had it all in place already. Nothing changed."; fi
  if [[ -n $aud && -n $team ]]; then
    ok "The app checks the signature of Cloudflare Access itself: it answers only through $DOMAIN, and port $HOST_PORT of this machine gets 403."
  else
    warn "Cloudflare gave no audience tag and team domain the app can use, so the app does not check the signature of Access itself. Access still guards $DOMAIN."
  fi
}

# the last lines of the install for a tunnel: what Access does and the redirect URL, or what is left to do by hand
cf_final() {
  if $CF_AUTO; then
    say "Cloudflare Access lets in only $ACCESS_EMAILS, with a one-time PIN sent by email, before the app's own login."
    say "Enable Banking redirect URL: ${bold}$APP_BASE_URL/api/connections/callback${reset}   ${dim}(add it to the app's Redirect URLs in the Enable Banking Control Panel)${reset}"
  elif [[ ! -e $CF_FILE ]]; then
    say "${dim}Cloudflare: the tunnel's Public hostname http://banking:8080 and an Access rule for your own email.${reset}"
  fi
}

# --cloudflare-down: removes what cf_up made for the copy in this folder. Needs the app image, nothing else is installed.
cf_down() {
  local rc=0
  [[ -f $ENV_FILE ]] || die "There is no install in this folder (.env is missing)."
  INSTANCE=$(existing INSTANCE_NAME); INSTANCE=${INSTANCE:-$DEFAULT_INSTANCE}
  [[ $INSTANCE =~ ^[a-z0-9][a-z0-9_-]*$ ]] || die "INSTANCE_NAME in .env is invalid: $INSTANCE"
  DOMAIN=$(existing DOMAIN); ACCESS_EMAILS=$(existing CLOUDFLARE_ACCESS_EMAILS)
  [[ -n $DOMAIN ]] && valid_domain "$DOMAIN" || die "This copy has no public address in .env (DOMAIN), so there is nothing to remove in Cloudflare."
  # only what this copy made: a host it never got (taken by another copy, or a run that stopped) may be another copy's
  cf_mine "$DOMAIN" || die "Cloudflare's $DOMAIN is not this copy's: the installer did not make it for this copy, or a run stopped or was refused before it did, or it was removed already. Nothing was removed, as it may be another copy's. Remove what is left in the Zero Trust dashboard if it is this copy's."
  cf_load || die "The Cloudflare file $CF_FILE is missing. It holds the API token that removes the tunnel (docs/ADVANCED.md, Cloudflare Tunnel)."
  command -v docker >/dev/null && docker info >/dev/null 2>&1 || die "Docker does not respond. Start it and run this again."
  docker image inspect "$INSTANCE:latest" >/dev/null 2>&1 || die "The image $INSTANCE:latest is missing. Start the copy once (docker compose up -d), then run this again."
  step "Removing the Cloudflare tunnel of $INSTANCE"
  cf_run down "$INSTANCE" "$DOMAIN" || rc=$?
  # exit 3: Cloudflare refused a step, or something that can still lead to the address was left and Access was kept
  # (the command's line says which). The address is not taken down, so .env keeps it as this copy's and a second run
  # finishes the removal.
  ((rc != 3)) || die "Cloudflare still has something of $DOMAIN (see above), so the address is still this copy's and .env was left as it is. Fix what the line above names, then run this again."
  ((rc == 0)) || cf_fail "$rc"
  # the host is not this copy's any more: a later install asks for it with --new. The Access application is gone and
  # its audience tag with it, so the pair goes too.
  env_set "CLOUDFLARE_NEW_HOST=$DOMAIN" CF_ACCESS_AUD CF_ACCESS_TEAM_DOMAIN
  ok "Cloudflare has no tunnel, address or Access rule of $DOMAIN from this install any more."
  say "${dim}The app cannot be reached by that address now. To choose another way in: ./scripts/install.sh --reconfigure${reset}"
  exit 0
}
