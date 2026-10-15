#!/usr/bin/env bash
# Tests for the source install of scripts/ops-helper.sh: the update from a git remote, the checks on the remote and on the
# docker-compose.yml of the new commit (scripts/lib/ops-git.sh), the signers, and the helper's pick of the commit that
# update.sh installs. The release install, the poll, the actions and the libs' call sites are in ops-helper.test.sh.
#
#   tools/test/ops-helper-source.test.sh [name-filter]
#
# The world (stubs, clone, ticks) is tools/test/ops-world.sh, shared with ops-helper.test.sh and the suites of the libs.
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
# shellcheck disable=SC2034 # read by ops-world.sh
SRC=${OPS_TEST_SRC:-$(cd "$HERE/../.." && pwd)}
FILTER=${1:-}
want() { [[ -z $FILTER || $1 == *$FILTER* ]]; }
# shellcheck source=ops-world.sh
. "$HERE/ops-world.sh"
unprivileged ops-helper-source.test.sh "$@"

# ── source mode ─────────────────────────────────────────────────────────────
t_source_update() {
  new_world; setenv TALOUS_CHANNEL=source; src_commit; src_commit
  echo 'export const APP_VERSION = "0.1.1";' >"$W/seed/apps/server/src/version.ts"; git -C "$W/seed" add -A; git -C "$W/seed" commit -qm v; git -C "$W/seed" push -q origin main 2>/dev/null
  poll update; tick
  check "source: fast-forward update reported ok" reported ok
  check "source: built and started" bash -c "[[ $(grep -c '^docker compose build' "$S/calls.log") = 1 && $(cver) = 0.1.1 ]]"
  check "source: checkout moved to origin/main" test "$(head_commit)" = "$(git -C "$W/seed" rev-parse HEAD)"
}
t_source_force_push() {
  new_world; setenv TALOUS_CHANNEL=source; src_commit; src_commit; git -C "$CL" fetch -q origin 2>/dev/null; git -C "$CL" merge -q --ff-only origin/main
  local before; before=$(head_commit)
  git -C "$W/seed" reset -q --hard "$C1"; src_commit; git -C "$W/seed" push -q -f origin main 2>/dev/null
  poll update; tick
  check "source: force-pushed branch refused" reported failed
  check "source: force push, no build" test "$(n_calls '^docker compose build')" = 0
  check "source: force push, checkout unchanged" test "$(head_commit)" = "$before"
}
t_source_url_branch_dirty() {
  new_world; setenv TALOUS_CHANNEL=source; src_commit
  git -C "$CL" remote set-url origin "file://$W/elsewhere.git"; poll update; tick
  check "source: changed remote URL refused" bash -c "grep -q 'Päivityslähde on muuttunut' '$S/reports/1.json'"
  git -C "$CL" remote set-url origin "file://$W/origin.git"; rm -f "$S/reports"/*
  git -C "$CL" checkout -q -b other; poll update "$ID2"; tick
  check "source: changed branch refused" grep -q 'Päivityslähteen versiolinja on muuttunut' <<<"$(report)"
  git -C "$CL" checkout -q main; echo dirty >>"$CL/scripts/doctor.sh"; rm -f "$S/reports"/*
  poll update op_1111111111111111; tick
  check "source: dirty tree refused" grep -q 'muutettu käsin' <<<"$(report)"
  check "source: none of the refusals built anything" test "$(n_calls '^docker compose build')" = 0
}
t_source_remote_types() {
  new_world; setenv TALOUS_CHANNEL=source; src_commit
  local u
  for u in http://example.invalid/x.git git://example.invalid/x.git ext::sh%20-c%20id; do
    git -C "$CL" remote set-url origin "$u"; printf 'REMOTE_URL=%s\nBRANCH=main\n' "$u" >"$CL/ops/policy"
    rm -f "$S/reports"/*; poll update; tick
    check "source: remote $u refused" reported failed
  done
  check "source: no fetch or build from a refused scheme" test "$(n_calls '^docker (compose build|pull)')" = 0
}
# inject ANCHOR_REGEX TEXT: TEXT after the first line of the seed's compose file that matches
inject() { awk -v re="$1" -v add="$2" '{print} $0 ~ re && !d {print add; d=1}' "$W/seed/docker-compose.yml" >"$W/seed/dc.new" && mv "$W/seed/dc.new" "$W/seed/docker-compose.yml"; }
# policy_case NAME CMD...: a fresh seed at the first commit, CMD changes it, one source update must be refused
policy_case() {
  local name=$1; shift
  git -C "$W/seed" fetch -q origin 2>/dev/null; git -C "$W/seed" reset -q --hard "$C1"; git -C "$W/seed" clean -qfd; git -C "$W/seed" push -q -f origin main 2>/dev/null; git -C "$CL" fetch -q origin 2>/dev/null
  "$@"
  git -C "$W/seed" add -A; git -C "$W/seed" commit -qm "evil compose"; git -C "$W/seed" push -q origin main 2>/dev/null
  rm -f "$S/reports"/*; : >"$S/calls.log"; poll update; tick
  check "source: $name refused before build" bash -c "grep -q 'turvasääntöjä' '$S/reports/1.json' && [[ $(grep -c '^docker compose build' "$S/calls.log") = 0 ]]"
}
t_source_compose_policy() {
  new_world; setenv TALOUS_CHANNEL=source
  [[ -x /usr/bin/docker ]] && /usr/bin/docker compose version >/dev/null 2>&1 || { fail "compose policy: needs docker compose on this machine"; return; }
  policy_case "privileged" inject '^  banking:$' "    privileged: true"
  policy_case "quoted privileged and pid" inject '^  banking:$' '    "privileged": true\n    "pid": "host"'
  policy_case "flow merge" inject '^  banking:$' "    <<: {privileged: true, pid: host}"
  policy_case "cap_add" inject '^  banking:$' "    cap_add: [SYS_ADMIN]"
  policy_case "network_mode host" inject '^  banking:$' "    network_mode: host"
  policy_case "long bind of /" inject 'banking-secrets:/secrets' '      - type: bind\n        source: /\n        target: /host'
  policy_case "flow bind of /" inject 'banking-secrets:/secrets' "      - {type: bind, source: /, target: /host}"
  policy_case "short bind of the Docker socket" inject 'banking-secrets:/secrets' "      - /var/run/docker.sock:/var/run/docker.sock"
  policy_case "named volume bound to a host path" sed -i 's#^  banking-data:$#  banking-data:\n    driver_opts: {type: none, o: bind, device: /root}#' "$W/seed/docker-compose.yml"
  policy_case "top-level secret from a host file" bash -c "printf 'secrets:\n  sh:\n    file: /etc/shadow\n' >>'$W/seed/docker-compose.yml' && awk '{print} /banking-secrets:\/secrets/ && !d {print \"    secrets: [sh]\"; d=1}' '$W/seed/docker-compose.yml' >'$W/seed/dc.new' && mv '$W/seed/dc.new' '$W/seed/docker-compose.yml'"
  policy_case "other image" sed -i 's#image: caddy:2#image: evil/caddy:2#' "$W/seed/docker-compose.yml"
  policy_case "other service" inject '^services:$' "  extra:\n    image: caddy:2"
  policy_case "extra capability-free key (devices)" inject '^  banking:$' "    devices: [/dev/sda:/dev/sda]"
  policy_case "a compose.yaml next to it" bash -c "printf 'services: {}\n' >'$W/seed/compose.yaml'"
  policy_case "an override file" bash -c "printf 'services: {}\n' >'$W/seed/docker-compose.override.yml'"
  local i h; h=$(printf %064d 0); for i in evil/cloudflared:2026.9.1 "evil/cloudflared:latest@sha256:$h" ghcr.io/cloudflare/cloudflared:2026.9.1 cloudflare/cloudflared:2026.9.1-arm64 cloudflare/cloudflared:2026.9 "cloudflare/cloudflared:2026.9.1@sha256:${h:1}" "cloudflare/cloudflared@sha256:$h" "cloudflare/cloudflared:latest@sha256:$h"; do policy_case "tunnel image $i" sed -i "s#image: cloudflare/cloudflared.*#image: $i#" "$W/seed/docker-compose.yml"; done
}
t_real_compose_passes() { # as it is, and with the tunnel image at latest or pinned to a cloudflared release, with and without a digest
  new_world; setenv TALOUS_CHANNEL=source
  [[ -x /usr/bin/docker ]] && /usr/bin/docker compose version >/dev/null 2>&1 || { fail "compose policy: needs docker compose on this machine"; return; }
  local i; for i in '' latest 2026.9.1 "2026.9.1@sha256:$(printf %064d 0)"; do [[ -z $i ]] || sed -i "s#image: cloudflare/cloudflared.*#image: cloudflare/cloudflared:$i#" "$W/seed/docker-compose.yml"; src_commit
    check "source: the project's own docker-compose.yml passes the policy check${i:+ with the tunnel image at $i}" bash -c "cd '$CL' && export PATH='$S/bin:/usr/bin:/bin' && mkdir -p ops/run && source <(sed -n '/^COMPOSE_JQ=/,/^}/p' scripts/lib/ops-git.sh) && OPS=ops && git fetch -q origin && git show origin/main:docker-compose.yml | grep 'image: cloudflare/cloudflared.*$i\$' >/dev/null && compose_policy_ok origin/main || { echo \"\$POLICY_MSG\"; exit 1; }"
  done
}
make_signers() {
  ssh-keygen -q -t ed25519 -N '' -f "$W/key1" -C k1; ssh-keygen -q -t ed25519 -N '' -f "$W/key2" -C k2
  printf 'test@example.com namespaces="git" %s\n' "$(cut -d' ' -f1,2 "$W/key1.pub")" >"$CL/ops/allowed_signers"; chmod 600 "$CL/ops/allowed_signers"
}
signed_commit() { # signed_commit KEYFILE
  echo "s$RANDOM" >>"$W/seed/CHANGES"; git -C "$W/seed" add -A
  git -C "$W/seed" -c gpg.format=ssh -c "user.signingkey=$1" commit -q -S -m signed && git -C "$W/seed" push -q origin main 2>/dev/null
}
t_source_signatures() {
  new_world; setenv TALOUS_CHANNEL=source; make_signers
  src_commit; poll update; tick
  check "source: unsigned commit refused when a signers file exists" grep -q 'allekirjoittanut' <<<"$(report)"
  new_world; setenv TALOUS_CHANNEL=source; make_signers
  signed_commit "$W/key2"; poll update; tick
  check "source: commit signed by another key refused" grep -q 'allekirjoittanut' <<<"$(report)"
  new_world; setenv TALOUS_CHANNEL=source; make_signers
  src_commit; signed_commit "$W/key1"; poll update; tick
  check "source: a signed tip over an unsigned commit refused" grep -q 'allekirjoittanut' <<<"$(report)"
  new_world; setenv TALOUS_CHANNEL=source; make_signers
  signed_commit "$W/key1"; poll update; tick
  check "source: commit signed by the trusted key goes through" reported ok
  check "source: only the good one built" test "$(n_calls '^docker compose build')" = 1
}
t_source_check_update() {
  new_world; setenv TALOUS_CHANNEL=source; src_commit; poll check-update; tick
  check "source: check lists the new commit" grep -q '"behind_commits":\[{"hash"' "$S/reports/1.json"
  check "source: check says an update is available" grep -q '"update_available":true' "$S/reports/1.json"
}

# ── the helper picks the commit, update.sh installs only that one ───────────
t_rt_tag_bypasses_signers() {
  # a signed commit on main, and an unsigned commit on a side branch tagged as a newer release
  new_world; make_signers
  signed_commit "$W/key1"
  local good; good=$(git -C "$W/seed" rev-parse HEAD)
  git -C "$W/seed" checkout -q -b side "$C1"
  printf 'echo pwned >>"$OPS_STUB_DIR/calls.log"\n' >>"$W/seed/scripts/ops-helper.sh"
  git -C "$W/seed" add -A; git -C "$W/seed" commit -qm "unsigned"; git -C "$W/seed" tag v0.9.0
  git -C "$W/seed" push -q origin side v0.9.0 2>/dev/null; git -C "$W/seed" checkout -q main
  echo "0.9.0|$(git -C "$W/seed" rev-parse v0.9.0)|1" >"$S/registry/0.9.0"
  setenv TALOUS_CHANNEL=source # GitHub saying "no release" with a release tag in the folder is no answer (channel.test.sh)
  git -C "$CL" fetch -q --tags origin 2>/dev/null
  poll update; tick
  check "tag bypass: the signed main commit is what gets installed" test "$(head_commit)" = "$good"
  check "tag bypass: the unsigned tag is not an ancestor of HEAD" bash -c "! git -C '$CL' merge-base --is-ancestor v0.9.0 HEAD"
  check "tag bypass: no release image pulled" test "$(n_calls '^docker pull')" = 0
  check "tag bypass: helper script unchanged" bash -c "! grep -q pwned '$CL/scripts/ops-helper.sh'"
}
t_rt_source_race() {
  # an unsigned commit lands after the helper's check, while update.sh is running
  new_world; setenv TALOUS_CHANNEL=source; make_signers
  signed_commit "$W/key1"
  local good; good=$(git -C "$W/seed" rev-parse HEAD)
  printf 'cd "%s" && echo evil >>CHANGES && git add -A && git -c user.name=t -c user.email=t@example.com commit -qm evil && git push -q origin main 2>/dev/null\n' "$W/seed" >"$S/race.sh"
  poll update; tick
  check "source race: the late commit did land on the remote" bash -c "git -C '$W/origin.git' log --format=%s main | grep evil >/dev/null"
  check "source race: exactly the checked commit is installed" test "$(head_commit)" = "$good"
  check "source race: reported ok" reported ok
}
t_rt_previous_retag() {
  new_world; release 0.2.0; poll update; tick
  release 0.3.0; touch "$S/cosignfail"; rm -f "$S/reports"/*; poll update "$ID2"; tick
  check "previous: the failed update reported failed" reported failed
  check "previous: :previous is still the 0.1.0 image" test "$(cut -d'|' -f1 "$S/images/banking-app_previous")" = 0.1.0
  rm -f "$S/cosignfail" "$S/reports"/*; poll rollback op_aaaaaaaaaaaaaaaa; tick
  check "previous: a rollback after the failed update goes to 0.1.0" bash -c "[[ $(cver) = 0.1.0 ]]"
}
t_release_not_on_main() {
  # a release tag whose commit is on a side branch, not on the pinned branch
  new_world
  git -C "$W/seed" checkout -q -b side
  echo 'export const APP_VERSION = "0.2.0";' >"$W/seed/apps/server/src/version.ts"
  git -C "$W/seed" add -A; git -C "$W/seed" commit -qm side; git -C "$W/seed" tag v0.2.0
  git -C "$W/seed" push -q origin side v0.2.0 2>/dev/null; git -C "$W/seed" checkout -q main
  echo "0.2.0|$(git -C "$W/seed" rev-parse v0.2.0)|1" >"$S/registry/0.2.0"
  printf '{\n  "tag_name": "v0.2.0",\n  "body": "x"\n}\n' >"$S/release.json"
  poll update; tick
  check "release: a tag that is not on the pinned branch is refused" reported failed
  check "release: nothing pulled for it" test "$(n_calls '^docker pull')" = 0
}
t_release_signers() {
  new_world; make_signers; release 0.2.0; poll update; tick
  check "release: unsigned release commit refused when a signers file exists" grep -q 'allekirjoittanut' <<<"$(report)"
  check "release: nothing pulled" test "$(n_calls '^docker pull')" = 0
  new_world; make_signers
  echo 'export const APP_VERSION = "0.2.0";' >"$W/seed/apps/server/src/version.ts"; git -C "$W/seed" add -A
  git -C "$W/seed" -c gpg.format=ssh -c "user.signingkey=$W/key1" commit -q -S -m "release 0.2.0"; git -C "$W/seed" tag v0.2.0
  git -C "$W/seed" push -q origin main v0.2.0 2>/dev/null
  echo "0.2.0|$(git -C "$W/seed" rev-parse HEAD)|1" >"$S/registry/0.2.0"
  printf '{\n  "tag_name": "v0.2.0",\n  "body": "x"\n}\n' >"$S/release.json"
  poll update; tick
  check "release: a signed release commit goes through" reported ok
}
t_git_config_pinned() {
  new_world; setenv TALOUS_CHANNEL=source; src_commit
  printf '[gpg "ssh"]\n\tprogram = %s/pwn.sh\n' "$W" >>"$CL/.git/config"
  printf '#!/bin/sh\ntouch %s/pwned\nexit 1\n' "$W" >"$W/pwn.sh"; chmod +x "$W/pwn.sh"
  make_signers; poll update; tick
  check "git config: gpg.ssh.program from .git/config is not run" test ! -e "$W/pwned"
  chmod 664 "$CL/.git/config"; : >"$S/calls.log"; rm -f "$S/reports"/*; poll backup op_9999999999999999; tick
  check "git config: a group-writable .git/config stops the helper" bash -c "[[ $TICK_RC != 0 && \$(grep -c 'backup.sh ran' '$S/calls.log') = 0 ]]"
}

for t in $(declare -F | awk '{print $3}' | grep '^t_'); do
  want "$t" || continue
  echo "── ${t#t_}"
  "$t"
done
echo
echo "$PASS passed, $FAILED failed"
((FAILED == 0))
