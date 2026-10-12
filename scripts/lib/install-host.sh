# shellcheck shell=bash
# shellcheck disable=SC2154,SC2034  # the installer's variables (colours, YES, ROOT, A_*, ...) are set and read in install.sh
# The machine side of install.sh (sourced, not run), kept here so that install.sh stays under its size cap:
#   - the answers a re-exec carries (save_answers, load_answers, settle_answers) and the re-exec itself, which gets the
#     docker group into the session (reexec_with_group: sg, else sudo, else the user opens the session again)
#   - Docker: the check and its fixes before the questions (docker_ready), the install and the other waiting steps after
#     the last answer (prep_host)
#   - the Cloudflare settings file for choice 3 (cf_setup_if_missing)
# Uses the installer's globals and helpers (die, say, ok, warn, confirm, as_root, in_docker_group, A_*, YES, ...).

# The answers a re-exec handed over (reexec_with_group writes them to a private file, so a token never shows in ps and
# nothing is asked twice). Only a re-exec reads it, only its own file (a plain file of ours, no link), and each line is
# matched against a fixed list of names, never evaluated. The file goes away at once: the parent takes that as "it ran".
load_answers() {
  local f=${TALOUS_ANSWERS:-} k v
  unset TALOUS_ANSWERS
  [[ -n ${TALOUS_REEXEC:-} && -n $f && -f $f && ! -L $f && -O $f ]] || return 0
  while IFS='=' read -r k v || [[ -n $k ]]; do
    case $k in
      NAME) PRESET_NAME=$v ;;
      ACCESS) A_ACCESS=$v ;;
      DOMAIN) A_DOMAIN=$v ;;
      EMAIL) A_EMAIL=$v ;;
      PORT) A_PORT=$v ;;
      BIND) A_BIND=$v ;;
      ACCESS_EMAILS) A_ACCESS_EMAILS=$v ;;
      TOKEN) A_TOKEN=$v ;;
      URL_ADDR) A_URL_ADDR=$v ;;
      OPS_HELPER) [[ $v == true || $v == false ]] && OPS_HELPER=$v ;;
      CHANNEL) [[ -z $v ]] || export TALOUS_CHANNEL=$v ;;
    esac
  done <"$f"
  rm -f "$f"
}

# Once every question is answered the answers replace the flags in the A_* variables, so that a re-exec after the
# Docker install (reexec_with_group) hands them on and nothing is asked twice.
settle_answers() {
  $EXISTING || PRESET_NAME=$INSTANCE
  A_ACCESS=$ACCESS; A_PORT=$HOST_PORT
  case $ACCESS in
    1) A_BIND=$BIND_ADDRESS; [[ $BIND_ADDRESS != 0.0.0.0 ]] || A_URL_ADDR=$url_addr ;;
    3) A_DOMAIN=$DOMAIN; A_ACCESS_EMAILS=${ACCESS_EMAILS:-}; A_TOKEN=$TUNNEL_TOKEN ;;
    4) A_DOMAIN=$DOMAIN; A_EMAIL=$ACME_EMAIL; [[ -z $CADDY_ADDRESS ]] || A_BIND=$CADDY_ADDRESS ;;
  esac
}

# Where a Cloudflare API token is made. The permissions are listed beside it (docs/ADVANCED.md, "Cloudflare Tunnel"):
# Cloudflare documents no key for the Tunnel permission in its filled-in token links, so the link fills in nothing.
CF_TOKEN_URL='https://dash.cloudflare.com/profile/api-tokens'
# Choice 3 with no Cloudflare settings file: this makes the file with scripts/cloudflare-setup.sh (its own questions: the
# API token, the domain, the emails Access lets in), so nobody opens a second terminal. When that is refused or fails the
# install goes on with the tunnel token typed in by hand, as before. Nothing is asked with --yes, so nothing is run then.
cf_setup_if_missing() {
  [[ -z $A_TOKEN ]] || return 0   # a tunnel made by hand: the file is not wanted
  [[ ! -e $CF_FILE && ! -L $CF_FILE ]] || return 0
  [[ -x $ROOT/scripts/cloudflare-setup.sh ]] && ! $YES || return 0
  say "There is no Cloudflare settings file yet ($CF_FILE)."
  confirm "Make it now with ./scripts/cloudflare-setup.sh? It asks for an API token, the domain and who Access lets in." y || return 0
  say "The API token is made in the Cloudflare dashboard (Create Token, then Custom token):"
  say "  ${bold}$CF_TOKEN_URL${reset}"
  say "  ${dim}Give it these permissions: Account: Cloudflare Tunnel Edit; Account: Access: Apps and Policies Edit; Account: Access: Organizations, Identity Providers, and Groups Edit; Zone: DNS Edit; Zone: Zone Read.${reset}"
  if "$ROOT/scripts/cloudflare-setup.sh"; then
    ok "Cloudflare settings saved ($CF_FILE)."
  else
    warn "The Cloudflare setup did not finish. Going on with a tunnel token from the Cloudflare dashboard (Zero Trust > Networks > Tunnels). To use the settings file instead, run ./scripts/cloudflare-setup.sh and then this again."
  fi
}

# save_answers: what has been answered so far, for the re-exec. A private file (mktemp, mode 600), one NAME=value per line.
# The token is in it when one was given or typed. Prints the path.
save_answers() {
  local f
  f=$(mktemp) || return 1
  # the A_* variables hold the flags, the environment and, once everything is asked, the answers (settle_answers)
  {
    printf 'NAME=%s\nACCESS=%s\nDOMAIN=%s\nEMAIL=%s\nPORT=%s\nBIND=%s\n' "$PRESET_NAME" "$A_ACCESS" "$A_DOMAIN" "$A_EMAIL" "$A_PORT" "$A_BIND"
    printf 'ACCESS_EMAILS=%s\nTOKEN=%s\nURL_ADDR=%s\n' "$A_ACCESS_EMAILS" "$A_TOKEN" "$A_URL_ADDR"
    printf 'OPS_HELPER=%s\nCHANNEL=%s\n' "$OPS_HELPER" "${TALOUS_CHANNEL:-}"
  } >"$f"
  printf '%s' "$f"
}
# The docker group may be new to this login (the user was added to it a moment ago). The script runs again with the
# group, no logout needed, and takes its answers along. With sg it replaces itself. Ubuntu 26.04.1 has no sg: sudo does
# it there, because sudo sets the groups of the user it runs as from the group database, so the new group applies.
# It returns 1 when no way worked: the caller says to open the session again. One try only.
reexec_with_group() {
  [[ -z ${TALOUS_REEXEC:-} ]] || return 1
  local me=${USER:-$(id -un)} answers sudo_flags=() rc=0
  command -v sg >/dev/null || command -v sudo >/dev/null || return 1
  answers=$(save_answers) || return 1
  export TALOUS_REEXEC=1 TALOUS_ANSWERS=$answers
  exec 9<&-   # the new process takes the lock again
  if command -v sg >/dev/null; then
    say "Opening a new session with the docker group and continuing."
    exec sg docker -c "$(printf '%q ' "$ROOT/scripts/install.sh" ${ORIG_ARGS[@]+"${ORIG_ARGS[@]}"})"
  fi
  say "Continuing in a new session with the docker group."
  ! $YES || sudo_flags=(-n)
  # a child, not exec: when sudo itself refuses, the answers file is still there and the caller can say what to do
  trap '' INT TERM   # Ctrl-C reaches the child as well, which says so
  sudo ${sudo_flags[@]+"${sudo_flags[@]}"} -u "$me" env TALOUS_REEXEC=1 TALOUS_ANSWERS="$answers" "$ROOT/scripts/install.sh" ${ORIG_ARGS[@]+"${ORIG_ARGS[@]}"} || rc=$?
  if [[ -e $answers ]]; then   # the new run never started
    rm -f "$answers"; trap interrupted INT TERM; unset TALOUS_ANSWERS
    return 1
  fi
  REPORTED=true   # the new run said what there was to say
  exit "$rc"
}

docker_ready() {
  docker compose version >/dev/null 2>&1 || die "Docker Compose v2 is missing. Install it: sudo apt install docker-compose-plugin"
  if ! docker info >/dev/null 2>&1; then
    derr=$(docker info 2>&1 >/dev/null | head -3 || true)
    if [[ $derr == *"permission denied"* ]]; then
      if ! in_docker_group; then
        if ! $GROUP_OK && ! $YES && ! confirm "Your user has no access to Docker. Add it to the docker group (sudo usermod -aG docker ${USER:-$(id -un)})?" y; then
          die "The install cannot continue without the docker group. Run: sudo usermod -aG docker \$USER   and close the SSH connection and open it again (or log out and in)."
        fi
        as_root usermod -aG docker "${USER:-$(id -un)}" || die "Could not add the group. Run: sudo usermod -aG docker \$USER   and close the SSH connection and open it again (or log out and in)."
      fi
      reexec_with_group || true
      die "Your user has no access to Docker in this session yet. Close the SSH connection and open it again (or log out and in), then run ./scripts/install.sh again."
    else
      # the daemon is installed but not running
      if command -v systemctl >/dev/null && as_root systemctl start docker >/dev/null 2>&1; then
        for _ in $(seq 1 20); do docker info >/dev/null 2>&1 && break; sleep 1; done
      fi
      docker info >/dev/null 2>&1 || die "The Docker service does not start. Run: sudo systemctl start docker   and see why: sudo journalctl -u docker -n 30. Then run this again."
    fi
  fi
  ok "Docker $(docker version --format '{{.Server.Version}}'), Compose $(docker compose version --short)"
}

# Everything that waits on the machine and not on the person, in one place after the last answer: Docker itself when
# it is missing, the Docker service at boot, jq and the free disk.
prep_host() {
  local installer droot free_kb
  if $DOCKER_TODO; then
    step "Installing Docker"
    installer=$(mktemp)
    curl -fsSL https://get.docker.com -o "$installer" || { rm -f "$installer"; die "Could not download the Docker installer. Check the network connection (curl -I https://get.docker.com) and run this again."; }
    as_root sh "$installer" || { rm -f "$installer"; die "The Docker install failed. See the error above. Install guide: docs/INSTALL.md."; }
    rm -f "$installer"
    as_root systemctl enable --now docker >/dev/null 2>&1 || true
    hash -r
    docker_ready
  fi
  # after a reboot the app returns by itself only if the Docker service starts with the machine
  if command -v systemctl >/dev/null && systemctl cat docker.service >/dev/null 2>&1 && [[ $(systemctl is-enabled docker 2>/dev/null) != enabled ]]; then
    if as_root systemctl enable docker >/dev/null 2>&1; then ok "Docker now starts with the machine."
    else warn "Docker does not start with the machine, so the app does not come back by itself after a reboot. Run: sudo systemctl enable docker"; fi
  fi
  # the maintenance helper needs jq; install it without asking when apt and root rights are there, else the helper note stays
  if $OPS_HELPER && ! command -v jq >/dev/null 2>&1 && command -v apt-get >/dev/null 2>&1 && { ((EUID == 0)) || command -v sudo >/dev/null; }; then
    step "Installing jq"
    if as_root apt-get install -y jq >/dev/null 2>&1 || { as_root apt-get update >/dev/null 2>&1 && as_root apt-get install -y jq >/dev/null 2>&1; }; then
      ok "jq installed."
    else
      warn "Could not install jq. The maintenance helper needs it: sudo apt install jq"
    fi
  fi
  # a build needs about 2 GB; stopping half way on a full disk helps nobody
  droot=$(docker info -f '{{.DockerRootDir}}' 2>/dev/null || true)
  if [[ -n $droot && -d $droot ]]; then
    free_kb=$(df -Pk "$droot" 2>/dev/null | awk 'NR==2 {print $4}')
    if [[ -n ${free_kb:-} ]]; then
      ((free_kb >= 1024 * 1024)) || die "Only $((free_kb / 1024)) MB free on the disk ($droot), the build needs about 2 GB. Free some space (docker image prune -f; docker builder prune -f; df -h) and run this again."
      ((free_kb >= 2048 * 1024)) || warn "Only $((free_kb / 1024)) MB free on the disk. The build may stop half way if the space runs out."
    fi
  fi
}
