# shellcheck shell=bash
# shellcheck disable=SC2034 # GIT_MSG is read by act_update in the helper
# The helper's checks of a source install and of the compose file of the version about to be installed, for scripts/ops-helper.sh.
# The helper's load_libs sources this file after check_permissions has passed on scripts/lib; it defines functions and nothing
# else.
#
#   git_policy          act_update calls it before it fetches anything: the clone still has the remote and branch fixed at install.
#   compose_policy_ok C act_update calls it with the commit it is about to install (COMPOSE_JQ is its allowlist).
#   signers_ok C        act_update calls it with that commit: signed by a key of ops/allowed_signers, when that file exists.
#
# tools/ci/compose-compat.sh cuts COMPOSE_JQ and compose_policy_ok out of this file (or, in a release older than this file, out
# of the helper) to run an old policy on a new compose file: keep both as one block each, ended as they are.

# The remote and branch are the ones fixed at install (ops/policy), not whatever the clone says now.
git_policy() {
  local url want_url branch want_branch
  want_url=$(pol_get REMOTE_URL); want_branch=$(pol_get BRANCH)
  [[ -n $want_url && -n $want_branch ]] || { GIT_MSG="Ylläpitoapurin asetukset puuttuvat (aja ./scripts/install.sh --ops-helper)"; return 1; }
  url=$(git remote get-url origin 2>/dev/null || true)
  [[ $url == "$want_url" ]] || { GIT_MSG="Päivityslähde on muuttunut"; return 1; }
  case $url in
    https://* | ssh://* | git@*:*) ;;
    file://*) [[ ${OPS_TEST:-} == 1 ]] || { GIT_MSG="Päivityslähteen osoite ei ole sallittu"; return 1; } ;;
    *) GIT_MSG="Päivityslähteen osoite ei ole sallittu"; return 1 ;;
  esac
  branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || true)
  [[ $branch == "$want_branch" ]] || { GIT_MSG="Päivityslähteen versiolinja on muuttunut"; return 1; }
  git diff --quiet && git diff --cached --quiet || { GIT_MSG="Asennuskansion tiedostoja on muutettu käsin"; return 1; }
  return 0
}
# Policy check of the docker-compose.yml that is about to be used (R13). Compose itself resolves the file (quoted
# keys, merges, flow style, long-form mounts), and the resulting JSON is checked against an allowlist. It guards
# against a privileged container, a host mount or a secret from the host, not against a hostile Dockerfile.
COMPOSE_JQ='
  ["banking","caddy","tunnel"] as $names
  | ["build","cap_drop","command","container_name","depends_on","entrypoint","environment","image","mem_limit","networks","pids_limit","ports","profiles","read_only","restart","security_opt","stop_grace_period","tmpfs","volumes"] as $keys
  | {"banking":"banking-app:latest","caddy":"caddy:2","tunnel":"cloudflare/cloudflared:latest"} as $images | "^cloudflare/cloudflared:[0-9]{4}[.][0-9]{1,2}[.][0-9]+(@sha256:[0-9a-f]{64})?\\z" as $pin # the tunnel may also be pinned: a cloudflared release tag, with or without its digest
  | (.volumes // {}) as $named
  | [
      (keys_unsorted[] | select(IN("name","services","networks","volumes","x-talous-compat") | not) | "ylätason avain \(.)"),
      ((.networks // {}) | to_entries[] | select(.key != "default" or (((.value | keys_unsorted) - ["name","ipam"]) | length > 0)) | "verkko \(.key)"),
      ($named | to_entries[] | select(((.value | keys_unsorted) - ["name"]) | length > 0) | "taltio \(.key)"),
      ((.services // {}) | to_entries[] | .key as $n | .value as $s
        | (if ($names | index($n)) then empty else "palvelu \($n)" end),
          ($s | keys_unsorted[] | select(IN($keys[]) | not) | "\($n): avain \(.)"),
          (($s.image // "") as $i | if $i == ($images[$n] // "") or ($n == "tunnel" and ($i | test($pin))) then empty else "\($n): image \($s.image)" end),
          (if $s.entrypoint != null then "\($n): entrypoint" else empty end),
          (if $s.command != null and ($n != "tunnel" or $s.command != ["tunnel","--no-autoupdate","run"]) then "\($n): command" else empty end),
          (($s.security_opt // [])[] | select(. != "no-new-privileges:true") | "\($n): security_opt \(.)"),
          (($s.networks // {}) | keys_unsorted[] | select(. != "default") | "\($n): verkko \(.)"),
          (($s.tmpfs // [])[] | select((startswith("/tmp:") or . == "/tmp") | not) | "\($n): tmpfs \(.)"),
          (if $s.build != null and ($n != "banking" or ((($s.build | keys_unsorted) - ["context","dockerfile","args"]) | length > 0) or $s.build.context != $dir or ($s.build.dockerfile // "Dockerfile") != "Dockerfile") then "\($n): build" else empty end),
          (($s.volumes // [])[]
            | select(
                ((.type == "volume") and ((.source // "") as $v | ($named | has($v))) and (((.volume // {}) | keys_unsorted - ["nocopy"]) | length == 0))
                or ($n == "caddy" and .type == "bind" and .source == ($dir + "/deploy/Caddyfile") and .target == "/etc/caddy/Caddyfile" and .read_only == true)
                | not)
            | "\($n): liitos \(.source // .target)"))
    ] | .[]
'
compose_policy_ok() { # compose_policy_ok COMMIT: the commit's compose file, as Compose resolves it
  local dir out names rc=0
  command -v jq >/dev/null || { POLICY_MSG="jq puuttuu"; return 1; }
  # other files Compose or .env would read next to it
  names=$(git ls-tree --name-only "$1" 2>/dev/null) || { POLICY_MSG="versiota ei löydy"; return 1; }
  if grep -qiE '^(compose\.ya?ml|docker-compose\.yaml|\.env|.*override.*)$' <<<"$names"; then POLICY_MSG="ylimääräinen asetustiedosto"; return 1; fi
  dir=$(mktemp -d "$OPS/run/policy.XXXXXX") || { POLICY_MSG="väliaikaiskansio puuttuu"; return 1; }
  dir=$(cd "$dir" && pwd -P)
  git show "$1:docker-compose.yml" >"$dir/docker-compose.yml" 2>/dev/null || { rm -rf "$dir"; POLICY_MSG="docker-compose.yml puuttuu"; return 1; }
  out=$(cd "$dir" && timeout 30 env -i PATH="$PATH" HOME="${HOME:-/}" docker compose -f docker-compose.yml --env-file /dev/null --profile '*' config --format json 2>/dev/null) || rc=$?
  if ((rc != 0)) || [[ -z $out ]]; then rm -rf "$dir"; POLICY_MSG="asetustiedostoa ei voi lukea"; return 1; fi
  POLICY_MSG=$(jq -r --arg dir "$dir" "$COMPOSE_JQ" <<<"$out" 2>&1 | head -3 | paste -sd';' -)
  rm -rf "$dir"
  [[ -z $POLICY_MSG ]]
}
# signers_ok COMMIT: when ops/allowed_signers exists, every commit between HEAD and COMMIT must be signed by one
# of its keys (a signed tip vouches only for itself). The file is the one fixed at install, never the checkout's.
signers_ok() {
  [[ -f $OPS/allowed_signers ]] || return 0
  local c n=0
  while IFS= read -r c; do
    n=$((n + 1)); ((n <= 200)) || return 1
    git -c gpg.format=ssh -c "gpg.ssh.allowedSignersFile=$ROOT/$OPS/allowed_signers" verify-commit "$c" >/dev/null 2>&1 || return 1
  done < <(git rev-list "HEAD..$1" 2>/dev/null)
  ((n > 0))
}
