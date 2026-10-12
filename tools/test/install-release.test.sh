#!/usr/bin/env bash
# Tests for what the installer does with the release channel, on a fake host (tools/test/fake-host.sh):
#   - --new-instance puts the new clone on the release this clone is at (the tag vX.Y.Z at HEAD), never the highest tag,
#     and moves the branch only when the release commit is on origin/main (relay/install.sh follows the same rule)
#   - a re-run or --reconfigure keeps TALOUS_CHANNEL and TALOUS_PRERELEASE in .env, and writes TALOUS_CHANNEL once
# A full install runs against a docker stub that plays the release image (pull, digest, labels) and a cosign stub, so
# the install goes the release way the signed image is fetched. Nothing touches the real host or the network.
#
#   tools/test/install-release.test.sh [name-filter]
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
# shellcheck disable=SC2034 # read by fake-host.sh
SRC=${OPS_TEST_SRC:-$(cd "$HERE/../.." && pwd)}
FILTER=${1:-}
# shellcheck source=fake-host.sh
. "$HERE/fake-host.sh"
unprivileged install-release.test.sh "$FILTER"
host_init
want() { [[ -z $FILTER || $1 == *$FILTER* ]]; }

IMG=ghcr.io/jouni-mikkola/omatalous
# the stub docker of the whole install: it logs every call (S/docker.log) and answers for the release image of the
# version it was last asked to pull (S/pulled): the digest, the commit of that tag in the folder it runs in, the version
# and the compose layout number the release file has
write_docker() {
  cat >"$S/bin/docker" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$*" >>"$S/docker.log"
case $1 in
  version) echo 27.0.0 ;;
  container) exit 1 ;;
  pull) echo "${2##*:}" >"$S/pulled" ;;
  image)
    if [[ $2 == inspect && $3 == -f ]]; then
      case $4 in
        *RepoDigests*) echo "ghcr.io/jouni-mikkola/omatalous@sha256:$(printf '%064d' 7)" ;;
        *talous.commit*) git rev-parse "refs/tags/v$(cat "$S/pulled")^{commit}" ;;
        *talous.version*) cat "$S/pulled" ;;
        *talous.compose*) echo 3 ;;
      esac
    fi ;;
  compose)
    case $2 in
      version) echo 2.29.0 ;;
      ps) [[ -e $S/container ]] && echo abc123 ;;
      exec) [[ $* == *" setup-code" ]] && echo k3f9-2mxq-8hzt-p4wa ;;
    esac ;;
esac
exit 0
EOF
  printf '#!/bin/sh\necho "$*" >>"$S/cosign.log"\n' >"$S/bin/cosign"
  chmod +x "$S/bin/docker" "$S/bin/cosign"
}
# A world with releases: v0.9.0 (the commit with the compose file) and v0.9.1 on a later commit, both on origin/main.
# This clone is on main at v0.9.0 as a household's is, one release behind origin/main.
rel_world() {
  new_host
  local origin="file://$W/origin.git"
  printf 'x-talous-compat: 3\nservices: {}\n' >"$W/seed/docker-compose.yml"
  git -C "$W/seed" add -A; git -C "$W/seed" commit -qm "release 0.9.0"; git -C "$W/seed" tag v0.9.0
  git -C "$W/seed" commit -q --allow-empty -m "release 0.9.1"; git -C "$W/seed" tag v0.9.1
  git -C "$W/seed" push -q "$origin" main --tags 2>/dev/null
  rm -rf "$CL"; git clone -q "$origin" "$CL" 2>/dev/null
  git -C "$CL" reset -q --hard v0.9.0
  printf 'INSTANCE_NAME=banking-app\n' >"$CL/.env"; chmod 600 "$CL/.env"
  write_docker
}
# the whole installer in this clone, no input, the maintenance helper left out
run_install() {
  in_clone env TALOUS_OPS_HELPER=0 ./scripts/install.sh "$@" </dev/null >"$W/install.out" 2>&1; INSTALL_RC=$?
}
why() { [[ $INSTALL_RC = 0 ]] || tail -n 12 "$W/install.out" | sed 's/^/       | /'; [[ -z ${DBG:-} ]] || { cat "$W/install.out"; cat "$S/docker.log"; }; }
installed() { test "$INSTALL_RC" = 0; }
said() { local x; for x in "$@"; do grep -qF -- "$x" "$W/install.out" || return 1; done; }
logged() { grep -qxF -- "$1" "$S/docker.log"; }
# commit of a ref in a folder, and whether two refs are the same commit
rev() { git -C "$1" rev-parse "$2^{commit}"; }
same() { [[ $(rev "$1" "$2") == "$(rev "$3" "$4")" ]]; }
env_has() { grep -qxF -- "$1" "${2:-$CL}/.env"; }
# how many lines of .env start with KEY=
env_count() { grep -c "^$1=" "$CL/.env" || true; }
two() { echo "$W/two"; }

t_new_instance_at_release() {
  rel_world
  run_install --new-instance two --yes --access local; why
  check "the new clone holds the newer tag, so a newest-tag rule would show" test -n "$(git -C "$(two)" tag --list v0.9.1)"
  check "the new instance installs" installed
  check "its clone is at the release this clone is at (v0.9.0)" same "$(two)" HEAD "$CL" v0.9.0
  check "and not at the head of main, which is the newer release" bash -c "[[ \$(git -C '$(two)' rev-parse HEAD) != \$(git -C '$(two)' rev-parse origin/main) ]]"
  check "it is on the branch main, which still follows origin/main" bash -c "[[ \$(git -C '$(two)' symbolic-ref --short HEAD) = main && \$(git -C '$(two)' rev-parse --abbrev-ref '@{u}') = origin/main ]]"
  check "the install goes the release way: release v0.9.0, not v0.9.1" bash -c "grep -qF 'Channel: release v0.9.0' '$W/install.out' && ! grep -qF 'v0.9.1' '$W/install.out'"
  check "it pulls the image of 0.9.0 and not the newer one" bash -c "grep -qxF 'pull $IMG:0.9.0' '$S/docker.log' && ! grep -q '0.9.1' '$S/docker.log'"
  check "the signature is checked for the commit of v0.9.0" grep -qF -- "--certificate-github-workflow-sha $(rev "$CL" v0.9.0)" "$S/cosign.log"
  check "nothing is built from source" bash -c "! grep -qx 'compose build banking' '$S/docker.log'"
  check "the output says the new instance is on the release" said 'The new instance is on release v0.9.0'
}
t_new_instance_no_tag_at_head() {
  rel_world
  git -C "$W/seed" commit -q --allow-empty -m "work"; git -C "$W/seed" push -q "file://$W/origin.git" main 2>/dev/null
  git -C "$CL" pull -q --ff-only 2>/dev/null
  check "this clone has tags but none at HEAD" bash -c "[[ -n \$(git -C '$CL' tag --list 'v*') && -z \$(git -C '$CL' tag --points-at HEAD) ]]"
  run_install --new-instance two --yes --access local; why
  check "the new instance installs" installed
  check "its clone stays on the head of the branch" same "$(two)" HEAD "$CL" HEAD
  check "one line says this clone is not at a release" bash -c "[[ \$(grep -c 'not at a release' '$W/install.out') = 1 ]] && grep -qF 'stays on the head of main' '$W/install.out'"
  check "the source is built, no release image is pulled" bash -c "grep -qx 'compose build banking' '$S/docker.log' && ! grep -q '^pull ' '$S/docker.log' && ! grep -qF 'Channel: release' '$W/install.out'"
}
t_new_instance_release_off_main() {
  rel_world
  # main is ahead of its last release, a release on a side branch: its commit and tag are in the repository, not on main
  git -C "$W/seed" commit -q --allow-empty -m "work"
  git -C "$W/seed" checkout -q -b side v0.9.0; git -C "$W/seed" commit -q --allow-empty -m "side release"; git -C "$W/seed" tag v0.9.2
  git -C "$W/seed" push -q "file://$W/origin.git" main side v0.9.2 2>/dev/null; git -C "$W/seed" checkout -q main
  git -C "$CL" fetch -q --tags origin 2>/dev/null; git -C "$CL" reset -q --hard v0.9.2
  run_install --new-instance two --yes --access local; why
  check "the new instance installs" installed
  check "the new clone has the tag and the commit, and the commit is not on origin/main" bash -c "[[ \$(git -C '$(two)' rev-parse 'v0.9.2^{commit}') = \$(git -C '$CL' rev-parse HEAD) ]] && ! git -C '$(two)' merge-base --is-ancestor v0.9.2 origin/main"
  check "main does not move: it stays on the head of origin/main" same "$(two)" HEAD "$(two)" origin/main
  check "one line says why and that the head is kept" bash -c "[[ \$(grep -c 'is not on origin/main' '$W/install.out') = 1 ]] && grep -qF 'Release v0.9.2 is not on origin/main: the new instance stays on the head of main' '$W/install.out'"
  check "the source is built, no release image is pulled" bash -c "grep -qx 'compose build banking' '$S/docker.log' && ! grep -q '^pull ' '$S/docker.log'"
}
t_new_instance_tag_not_pushed() {
  rel_world
  git -C "$W/seed" commit -q --allow-empty -m "work"; git -C "$W/seed" push -q "file://$W/origin.git" main 2>/dev/null
  git -C "$CL" pull -q --ff-only 2>/dev/null; git -C "$CL" tag v0.9.3
  run_install --new-instance two --yes --access local; why
  check "the new instance installs" installed
  check "a tag only this clone has: the new clone stays on the head of main and says so" bash -c "grep -qF 'The remote repository has no tag v0.9.3' '$W/install.out' && [[ \$(git -C '$(two)' rev-parse HEAD) = \$(git -C '$CL' rev-parse HEAD) ]]"
  check "no release image is pulled" bash -c "! grep -q '^pull ' '$S/docker.log'"
}

# ── .env ──────────────────────────────────────────────────────────────────────────────────────────────────────────
t_env_keys_kept() {
  rel_world
  printf 'INSTANCE_NAME=banking-app\nTALOUS_CHANNEL=source\nTALOUS_PRERELEASE=1\n' >"$CL/.env"
  run_install --yes --access local; why
  check "an answer flag rewrites .env and the install succeeds" installed
  check "TALOUS_CHANNEL is kept" env_has 'TALOUS_CHANNEL=source'
  check "TALOUS_PRERELEASE is kept" env_has 'TALOUS_PRERELEASE=1'
  check "the old .env is backed up" bash -c "ls '$CL'/.env.bak.* >/dev/null 2>&1"
  printf 'INSTANCE_NAME=banking-app\nTALOUS_CHANNEL=release\nTALOUS_PRERELEASE=1\n' >"$CL/.env"
  run_install --reconfigure --yes --access local; why
  check "--reconfigure succeeds" installed
  check "--reconfigure keeps both keys" bash -c "grep -qx 'TALOUS_CHANNEL=release' '$CL/.env' && grep -qx 'TALOUS_PRERELEASE=1' '$CL/.env'"
  printf 'INSTANCE_NAME=banking-app\nTZ=Europe/Helsinki\n' >"$CL/.env"
  run_install --yes --access local
  check "an install without the two keys does not invent them" bash -c "! grep -q '^TALOUS_' '$CL/.env' && grep -qx 'TZ=Europe/Helsinki' '$CL/.env'"
}
# GitHub's /releases/latest for the installer: it names the tag in $S/api, or gives no answer when that file is missing.
# Every call is logged with its address.
write_curl() {
  cat >"$S/bin/curl" <<'EOF'
#!/usr/bin/env bash
echo "curl ${*: -1}" >>"$S/curl.log"
out=/dev/null; while (($#)); do [[ $1 != -o ]] || out=$2; shift; done
[[ -s $S/api ]] || exit 7
printf '{"tag_name":"%s","draft":false,"prerelease":false,"body":""}' "$(cat "$S/api")" >"$out"; printf 200
EOF
  chmod +x "$S/bin/curl"
}
# a folder cloned by hand from main while v0.9.1 is in its first two days: HEAD is at v0.9.1 and nothing was installed
fresh_world() { rel_world; git -C "$CL" reset -q --hard v0.9.1; rm -f "$CL/.env"; write_curl; [[ -z ${1:-} ]] || echo "$1" >"$S/api"; }
t_new_install_asks_which_release_is_out() {
  fresh_world v0.9.1; run_install --yes --access local; why
  check "GitHub names the tag at HEAD: the install takes it" bash -c "[[ $INSTALL_RC = 0 ]] && grep -qF 'Channel: release v0.9.1' '$W/install.out' && grep -qxF 'pull $IMG:0.9.1' '$S/docker.log'"
  check "GitHub names it: asked once, /releases/latest" test "$(cat "$S/curl.log")" = "curl https://api.github.com/repos/jouni-mikkola/omatalous/releases/latest"
  check "GitHub names it: the folder did not move" same "$CL" HEAD "$CL" v0.9.1
  check "the registry tag of the pulled image goes once the image is tagged for the instance, and no other tag does" bash -c "awk '/^image tag .*:latest\$/ {t=1} t && \$0 == \"image rm $IMG:0.9.1\" {f=1} END {exit !f}' '$S/docker.log' && ! grep -E '^image rm .*:(latest|previous)\$' '$S/docker.log' >/dev/null"
  fresh_world v0.9.0; run_install --yes --access local; why
  check "GitHub names the release below, so the tag at HEAD is a pre-release: the release GitHub names is installed" bash -c "[[ $INSTALL_RC = 0 ]] && grep -qF 'Channel: release v0.9.0' '$W/install.out' && grep -qxF 'pull $IMG:0.9.0' '$S/docker.log'"
  check "pre-release at HEAD: its image is not pulled and nothing is built from source" bash -c "! grep -q '0.9.1' '$S/docker.log' && ! grep -qx 'compose build banking' '$S/docker.log'"
  check "pre-release at HEAD: the folder is on main at v0.9.0" bash -c "[[ \$(git -C '$CL' symbolic-ref --short HEAD) = main && \$(git -C '$CL' rev-parse HEAD) = \$(git -C '$CL' rev-parse 'v0.9.0^{commit}') ]]"
  check "pre-release at HEAD: one line says so" test "$(grep -c 'which is not out yet' "$W/install.out")" = 1
  fresh_world; run_install --yes --access local; why
  check "GitHub gives no answer: the install goes on with the tag at HEAD" bash -c "[[ $INSTALL_RC = 0 ]] && grep -qF 'Channel: release v0.9.1' '$W/install.out'"
  check "GitHub gives no answer: one line says the release could not be confirmed" test "$(grep -c 'could not be confirmed' "$W/install.out")" = 1
  rel_world; write_curl; echo v0.8.0 >"$S/api"; run_install --yes --access local; why
  check "an installed folder (it has a .env) asks nothing and stays on its release" bash -c "[[ $INSTALL_RC = 0 && ! -e '$S/curl.log' ]] && grep -qF 'Channel: release v0.9.0' '$W/install.out'"
}
t_channel_written_once() {
  rel_world
  printf 'INSTANCE_NAME=banking-app\nTALOUS_CHANNEL=release\nTALOUS_PRERELEASE=1\n' >"$CL/.env"
  run_install --yes --access local; why
  check "the install of a release channel .env succeeds and goes the release way" bash -c "[[ $INSTALL_RC = 0 ]] && grep -qF 'Channel: release v0.9.0' '$W/install.out'"
  check "TALOUS_CHANNEL is in the new .env once" test "$(env_count TALOUS_CHANNEL)" = 1
  check "TALOUS_PRERELEASE is in it once" test "$(env_count TALOUS_PRERELEASE)" = 1
  check "the keys stand in the part kept from the previous .env" bash -c "awk '/^# Kept from the previous .env/ {k=1} k && /^TALOUS_CHANNEL=release\$/ {f=1} END {exit !f}' '$CL/.env'"
  run_install --yes; why
  check "a plain re-run leaves .env as it was (one line)" bash -c "[[ $INSTALL_RC = 0 ]] && [[ \$(grep -c '^TALOUS_CHANNEL=' '$CL/.env') = 1 ]]"
  rel_world
  run_install --yes --access local; why
  check "an install with no key in .env writes the channel at most once" test "$(env_count TALOUS_CHANNEL)" -le 1
}

for t in $(declare -F | awk '{print $3}' | grep '^t_'); do
  want "$t" || continue
  echo "── ${t#t_}"
  "$t"
done
echo
echo "$PASS passed, $FAILED failed"
((FAILED == 0))
