# Shared by scripts/update.sh and scripts/install.sh, sourced from the clone root. Needs die, ok and run_logged
# from the caller, and IMAGE (the local image name, <name>:latest is what docker-compose.yml starts). The functions that
# pick a release (release_mode to release_from_api, at the end) and those of the private channel (channel_get to switch_from)
# need none of that: the maintenance helper loads them too (lib/ops-release.sh), so they call nothing of the helper's or of
# update.sh's. Only choose_release, pick_private and pick_target are update.sh's: they also read its TARGET, MODE, say and
# channel_setting.
# shellcheck shell=bash disable=SC2154,SC2034

# What a released image must be signed by: this project's release workflow, run for a version tag or on main (a push of
# a new version, or by hand). Keep in step with .github/workflows/release.yml (a test compares them).
REGISTRY_IMAGE=ghcr.io/jouni-mikkola/omatalous
SIGN_IDENTITY_REGEXP='^https://github\.com/jouni-mikkola/omatalous/\.github/workflows/release\.yml@refs/(tags/v[0-9]+\.[0-9]+\.[0-9]+|heads/main)$'
SIGN_ISSUER='https://token.actions.githubusercontent.com'
# used when cosign is not installed on the machine; pinned by digest
COSIGN_IMAGE='ghcr.io/sigstore/cosign/cosign:v3.0.6@sha256:de9c65609e6bde17e6b48de485ee788407c9502fa08b8f4459f595b21f56cd00'

# The installer's lock: one run per folder for install.sh, update.sh, restore.sh, reset.sh and the helper's address change,
# housekeeping and watchdog. Run from the clone folder; it fails when another run holds the lock, and the lock goes away
# with the process (fd 9 and 6; `exec 9<&- 6<&-` gives it up before a child takes it). It is a flock on the folder itself,
# which no update replaces. Releases before 0.9.0 locked the file scripts/install.sh, which the merge of an update puts
# under a new inode. So that file is locked too, and a process that still holds the one an update has since replaced
# (0.8.7's update.sh during the update to this release) counts as a holder: /proc shows it as deleted on its fd 9.
installer_lock() {
  local p here
  exec 9<. 6<scripts/install.sh || return 1
  here=$(pwd -P)
  # the look at /proc comes before the locks, so a probe (the watchdog asks on every tick) holds the folder's lock for one
  # flock and no longer; fd 6 is open already, so a holder whose file is replaced meanwhile is still met on the name
  for p in /proc/[0-9]*/fd/9; do
    [[ $(readlink "$p" 2>/dev/null) != "$here/scripts/install.sh (deleted)" ]] || return 1
  done
  flock -n 9 && flock -n 6 || return 1
}
latest_release() { git tag --list 'v[0-9]*' --sort=-v:refname | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' | head -1 || true; }
image_label() { docker image inspect -f "{{index .Config.Labels \"$2\"}}" "$1" 2>/dev/null || true; }
# the layout number of docker-compose.yml at a commit (x-talous-compat)
compose_compat() { git show "$1:docker-compose.yml" 2>/dev/null | sed -n 's/^x-talous-compat: *\([0-9][0-9]*\).*/\1/p' | head -1 || true; }
# Checks the signature of an image by digest against this project's release workflow. cosign from the machine if
# there is one, else a pinned cosign image. Fails closed.
# The run that signed may have been started by a push or by hand. Installs before 0.5.1 accept only a push, so the
# release workflow signs from a push while those are supported (docs/RELEASING.md).
SIGN_TRIGGERS=(push workflow_dispatch)
verify_signature() { # verify_signature IMAGE_BY_DIGEST COMMIT: also pins the commit the workflow ran on
  local ref=$1 commit=$2 trigger
  for trigger in "${SIGN_TRIGGERS[@]}"; do
    cosign_verify "$ref" --certificate-github-workflow-sha "$commit" --certificate-github-workflow-trigger "$trigger" && return 0
  done
  return 1
}
cosign_verify() { # cosign_verify REF [extra cosign flags]: the identity and issuer every release must have
  local ref=$1; shift
  if command -v cosign >/dev/null; then
    cosign verify --certificate-identity-regexp "$SIGN_IDENTITY_REGEXP" --certificate-oidc-issuer "$SIGN_ISSUER" "$@" "$ref" >/dev/null 2>&1
  else
    docker run --rm "$COSIGN_IMAGE" verify --certificate-identity-regexp "$SIGN_IDENTITY_REGEXP" --certificate-oidc-issuer "$SIGN_ISSUER" "$@" "$ref" >/dev/null 2>&1
  fi
}
# Pulls the release image, verifies it and tags it as $IMAGE:latest. $1 = tag (vX.Y.Z), $2 = the commit it was built from.
# Two instances on one Docker may fetch the same version at the same moment, and the one that is done first removes the
# registry tag (below), which takes the image's digest by the registry with it. So the local image is asked for what it is
# right after the pull (its digest, its id, its labels) and by nothing that goes with that tag; when the tag is gone before
# that, the pull is made once more. The signature (a look at the registry) and the tag of $IMAGE:latest come after, by the
# digest and the id read here.
fetch_release_image() {
  pull_release_image "$1" "$2"
  docker image tag "$PULLED_ID" "$IMAGE:latest"
  # The image is used as $IMAGE:latest from here on. Its registry tag goes (rm of a tag only untags), or every old version
  # would keep a tag for good and `docker image prune` would never free one.
  docker image rm "$PULLED_REF" >/dev/null 2>&1 || true
}
# The pull and every check of fetch_release_image, with no tag of this install moved: PULLED_ID is the verified image's id
# and PULLED_REF its registry name, which the caller removes when done. update.sh --check uses it too.
pull_release_image() { # pull_release_image TAG COMMIT
  local version=${1#v} commit=$2 ref digest id got_commit got_version have want log rc try
  ref=$REGISTRY_IMAGE:$version
  for try in 1 2; do
    log=$(mktemp); rc=0
    run_logged "$log" "Pulling" docker pull "$ref" || rc=$?
    if ((rc != 0)); then
      tail -n 5 "$log" | cut -c1-200; rm -f "$log"
      die "Could not pull the image of version $version. Check the network (curl -I https://ghcr.io). ${KEEP_NOTE:-}"
    fi
    rm -f "$log"
    id=''; got_commit=''; got_version=''; have=''
    digest=$(docker image inspect -f '{{range .RepoDigests}}{{println .}}{{end}}' "$ref" 2>/dev/null | grep "^$REGISTRY_IMAGE@sha256:" | head -1 || true)
    if [[ -n $digest ]]; then
      id=$(docker image inspect -f '{{.Id}}' "$digest" 2>/dev/null || true)
      got_commit=$(image_label "$digest" talous.commit); got_version=$(image_label "$digest" talous.version); have=$(image_label "$digest" talous.compose)
    fi
    [[ -z $digest || -z $id || -z $got_commit || -z $got_version || -z $have ]] || break
  done
  [[ -n $digest && -n $id ]] || die "Could not read the image digest ($ref). ${KEEP_NOTE:-}"
  # the signature is checked on the digest, and the image is used by the same digest (its id, read from the digest)
  verify_signature "$digest" "$commit" || die "Could not verify the image signature ($digest). The image is not used. ${KEEP_NOTE:-}"
  ok "Signature verified: $digest"
  [[ $got_commit == "$commit" && $got_version == "$version" ]] \
    || die "The image does not match release $1 (version or commit differs). The image is not used."
  want=$(compose_compat "$commit")
  [[ -n $want && $have == "$want" ]] \
    || die "The image expects docker-compose.yml layout $have, the release file has $want. The image is not used."
  PULLED_ID=$id; PULLED_REF=$ref
}

# ── which release an install follows ────────────────────────────────────────
# One answer for update.sh run by hand and for the maintenance helper (the daily check, the Päivitä button). A release is a
# pre-release for its first 48 hours, and an install takes one only when .env says TALOUS_PRERELEASE=yes. Mode latest asks
# /releases/latest, which GitHub keeps free of pre-releases and drafts. Mode newest asks for the 20 newest releases and takes
# the highest vX.Y.Z that is no draft. The address is fixed here: nothing in the environment replaces it. The tag found still
# goes through the signature check (fetch_release_image) and the helper's own checks.
RELEASES_API=https://api.github.com/repos/jouni-mikkola/omatalous/releases
release_mode() { # the mode .env asks for (read as data); fails on a value that is not yes or no
  case $(grep -E '^TALOUS_PRERELEASE=' .env 2>/dev/null | tail -1 | cut -d= -f2- || true) in
    yes) echo newest ;;
    no | '') echo latest ;;
    *) return 1 ;;
  esac
}
release_get() { # release_get MODE FILE: asks the API, the answer goes to FILE, prints the HTTP code (000: no answer)
  local url=$RELEASES_API/latest code cap=()
  [[ $1 != newest ]] || url=$RELEASES_API'?per_page=20'
  [[ -z ${T_CHECK:-} ]] || cap=(timeout -k 5 "$T_CHECK") # the helper's limit for a check; by hand curl's own --max-time
  code=$(${cap[@]+"${cap[@]}"} curl -sS -o "$2" -w '%{http_code}' --max-time 30 --max-filesize 2000000 --proto '=https' --tlsv1.2 \
    -H 'Accept: application/vnd.github+json' -H 'X-GitHub-Api-Version: 2022-11-28' -A "talous-ops/${OPS_HELPER_VERSION:-update.sh}" "$url" 2>/dev/null) || code=000
  printf '%s' "$code"
}
# release_pick MODE FILE: the release to take from the answer in FILE, as "tag<TAB>notes" with the notes still JSON-escaped on
# one line. Only the keys of a release itself count, not those of its author or its files. A draft and a tag that is not
# vX.Y.Z never count, and in mode latest neither does a pre-release (GitHub does not send one; this is a second lock).
# Fails when nothing counts.
release_pick() {
  grep -oE '"([^"\\]|\\.)*"|[][{}:,]|[^][{}:,"[:space:]]+' "$2" | awk -v mode="$1" '
    function row(   a, b, i) {
      gsub(/^"|"$/, "", tag)
      if (tag !~ /^v[0-9]+\.[0-9]+\.[0-9]+$/ || draft == "true" || (mode == "latest" && pre == "true")) return
      if (best != "") {
        split(substr(tag, 2), a, /\./); split(substr(best, 2), b, /\./)
        i = 1; while (i <= 3 && a[i] + 0 == b[i] + 0) i++
        if (i > 3 || a[i] + 0 < b[i] + 0) return
      }
      best = tag; notes = (body ~ /^"/) ? substr(body, 2, length(body) - 2) : ""
    }
    $0 == ":" { key = prev; ev = 1; next }
    $0 == "," { ev = 0; next }
    $0 == "{" || $0 == "[" { d++; if ($0 == "{" && !rd) rd = d; if ($0 == "{" && d == rd) tag = draft = pre = body = ""; ev = 0; next }
    $0 == "}" || $0 == "]" { if ($0 == "}" && d == rd) row(); d--; ev = 0; next }
    ev { if (d == rd) { if (key == "\"tag_name\"") tag = $0; else if (key == "\"draft\"") draft = $0; else if (key == "\"prerelease\"") pre = $0; else if (key == "\"body\"") body = $0 } ev = 0; next }
    { prev = $0 }
    END { if (best == "") exit 1; printf "%s\t%s\n", best, notes }'
}
# release_answer MODE FILE: asks, then prints what release_pick prints. Fails with 1 when GitHub gave no usable answer, and with
# 2 when it says there is no release (404, or an empty list) and the folder holds no release tag: the one case in which an
# install may follow the source. "No release" while the folder holds a release tag is no answer (a release was made and GitHub
# does not show it), so it fails with 1 like an API error. It fails with 3 when GitHub turned the request down with 403 or 429,
# which is how it says that the limit of requests for this address was met (60 an hour without a key): an hour's wait cures it.
release_answer() {
  local code
  code=$(release_get "$1" "$2")
  case $code in
    404) ;;
    403 | 429) return 3 ;;
    200) release_pick "$1" "$2" && return 0
      [[ $1 == newest && $(tr -d ' \n\r\t' <"$2") == '[]' ]] || return 1 ;;
    *) return 1 ;;
  esac
  [[ -z $(latest_release) ]] || return 1
  return 2
}
release_from_api() { # release_from_api MODE: prints the tag to follow. Fails like release_answer
  local f row rc=0
  f=$(mktemp) || return 1
  row=$(release_answer "$1" "$f") || rc=$?
  rm -f "$f"
  ((rc == 0)) || return "$rc"
  printf '%s\n' "${row%%$'\t'*}"
}
# ── the private channel ─────────────────────────────────────────────────────
# scripts/use-private.sh switches one clone to follow a private repository: a second remote, `private`, read over SSH with
# a read-only deploy key (core.sshCommand), while origin and its history stay as they are. ops/channel (KEY=value lines,
# read as data, written only by use-private.sh) records it: CHANNEL=private, FOLLOW (a branch there, default main, or
# `tags` for its newest vX.Y.Z tag) and SINCE, the commit this folder was at when it switched. The private history
# descends from no public commit, so an update may move onto it only from exactly SINCE. --back writes CHANNEL=public
# and SINCE (the private commit), from which the next update may move to the newest public release. The private refs land
# under refs/remotes/private/ (tags under refs/remotes/private/tags/), so the release tags of this folder stay the public
# ones. Nothing here asks api.github.com and no token is needed. On this channel update.sh builds the image here, so the
# signature check of the release images does not apply.
CHANNEL_FILE=ops/channel
channel_get() { grep -E "^$1=" "$CHANNEL_FILE" 2>/dev/null | tail -1 | cut -d= -f2- || true; }
on_private() { [[ $(channel_get CHANNEL) == private ]]; }
private_follow() { # the branch the channel follows, or `tags`; fails on a name git would not take as one
  local f
  f=$(channel_get FOLLOW); f=${f:-main}
  [[ $f == tags || ($f =~ ^[A-Za-z0-9][A-Za-z0-9._/-]{0,99}$ && $f != *..* && $f != *.lock && $f != */ && $f != *//*) ]] || return 1
  printf '%s\n' "$f"
}
private_fetch() { # fetches what the channel follows, and nothing else; the helper's T_CHECK caps it
  local f cap=()
  f=$(private_follow) || return 1
  [[ -z ${T_CHECK:-} ]] || cap=(timeout -k 5 "$T_CHECK")
  if [[ $f == tags ]]; then
    GIT_TERMINAL_PROMPT=0 ${cap[@]+"${cap[@]}"} git fetch --quiet --no-tags --prune private '+refs/tags/v*:refs/remotes/private/tags/v*'
  else
    GIT_TERMINAL_PROMPT=0 ${cap[@]+"${cap[@]}"} git fetch --quiet --no-tags private "+refs/heads/$f:refs/remotes/private/$f"
  fi
}
private_ref() { # the ref the channel follows, from the last fetch
  local f t
  f=$(private_follow) || return 1
  if [[ $f == tags ]]; then
    t=$(git for-each-ref --format='%(refname:lstrip=4)' 'refs/remotes/private/tags/' | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' | sort -t. -k1.2,1n -k2,2n -k3,3n | tail -1 || true)
    [[ -n $t ]] || return 1
    printf 'refs/remotes/private/tags/%s\n' "$t"
  else
    printf 'refs/remotes/private/%s\n' "$f"
  fi
}
private_target() { local r; r=$(private_ref) && git rev-parse -q --verify "$r^{commit}"; }
switch_from() { # switch_from COMMIT: COMMIT is the SINCE of ops/channel, the one commit a channel switch moves away from
  local since
  since=$(channel_get SINCE)
  [[ $since =~ ^[0-9a-f]{40}$ && $(git rev-parse -q --verify "$1^{commit}" 2>/dev/null) == "$since" ]]
}
# For update.sh on the private channel: what pick_target sets, from the private remote. TARGET (the helper's choice) is
# taken as it is; by hand the private remote is fetched and the channel's ref read. CROSSED_FROM is set when the move
# leaves this folder's history (only from SINCE).
pick_private() {
  local f
  f=$(private_follow) || die "FOLLOW in ops/channel is invalid. Nothing was changed."
  git remote get-url private >/dev/null 2>&1 || die "ops/channel names the private channel, but this folder has no remote named private. Nothing was changed. Run ./scripts/use-private.sh --check, or go back with ./scripts/use-private.sh --back."
  prev_commit=$(git rev-parse HEAD); CHANNEL=source; tag=''; RELEASE_TAG=''; RELEASE_HELD=''; CROSSED_FROM=''
  if [[ -n $TARGET ]]; then
    [[ $MODE == private ]] || die "This folder follows the private repository (ops/channel), and the maintenance helper chose $MODE. Nothing was changed."
    git cat-file -e "$TARGET^{commit}" 2>/dev/null || die "Commit $TARGET is not in this folder."
    target=$TARGET
  else
    private_fetch || die "Could not read the private repository (git fetch private failed). Nothing was changed, the current version is running. Check the network and the deploy key: ./scripts/use-private.sh --check"
    target=$(private_target) || die "The private repository has nothing to follow ($f). Nothing was changed."
  fi
  if ! git merge-base --is-ancestor HEAD "$target" 2>/dev/null; then
    switch_from HEAD || die "The private repository's $f does not continue the history of this folder. Nothing was changed."
    CROSSED_FROM=$prev_commit
  fi
  say "Channel: private repository, $f at $(git rev-parse --short "$target"). Built on this machine, so the signature check of the release images does not apply."
}
# ── a new history ───────────────────────────────────────────────────────────
# From 0.66.0 the public repository may start its history again on a new root. A release there descends from no commit
# an install is on, so the ordinary check (HEAD is an ancestor of the release) fails. Such a release names what it
# continues in its tree: release/lineage, one line "continues vX.Y.Z <commit>". An install may move to it only from
# exactly that commit, which must carry that tag here. The image of the release is verified first as always
# (fetch_release_image: the signature pinned to the release commit), so only the release workflow of the public
# repository, run on that commit, can make a history an install moves to. Only the release channel moves this way.
lineage_of() { # lineage_of COMMIT: prints "vX.Y.Z COMMIT" from the commit's release/lineage; fails when it has none or a bad one
  local line
  line=$(git show "$1:release/lineage" 2>/dev/null | head -c 200 | head -1 || true)
  [[ $line =~ ^continues\ (v[0-9]+\.[0-9]+\.[0-9]+)\ ([0-9a-f]{40})$ ]] || return 1
  printf '%s %s\n' "${BASH_REMATCH[1]}" "${BASH_REMATCH[2]}"
}
crosses_from() { # crosses_from FROM TARGET: TARGET starts a new history that continues the release at FROM
  local l at
  l=$(lineage_of "$2") || return 1
  at=$(git rev-parse -q --verify "$1^{commit}" 2>/dev/null || true)
  [[ -n $at && ${l#* } == "$at" && $(git rev-parse -q --verify "refs/tags/${l% *}^{commit}" 2>/dev/null) == "$at" ]] || return 1
  # a new root shares no commit with the line it continues; anything else goes by the ordinary check
  ! git merge-base "$at" "$2" >/dev/null 2>&1
}
# A third way: FROM is the commit use-private.sh --back left this folder at (switch_from), and the release's image passes its
# signature check as every release's does.
continues() { # continues FROM TARGET: TARGET is FROM's history going on, or a new history that continues FROM's release
  git merge-base --is-ancestor "$1" "$2" 2>/dev/null || crosses_from "$1" "$2" || { ! on_private && switch_from "$1"; }
}
# For update.sh --rollback: COMMIT (of the state file) is an earlier version of this folder, or the commit a move to a new
# history came from (CROSSED_FROM of the state file), which the folder still holds.
earlier_commit() { # earlier_commit COMMIT CROSSED_FROM
  [[ $1 =~ ^[0-9a-f]{40}$ ]] && { git merge-base --is-ancestor "$1" HEAD 2>/dev/null || { [[ $2 == "$1" ]] && git cat-file -e "$1^{commit}" 2>/dev/null; }; }
}
# For update.sh --rollback: the first three files git does not track that COMMIT has, on one line. `git reset --keep`
# refuses to write over them, and git diff does not see them. An ignored file is not listed: reset writes over it.
untracked_in_way() { # untracked_in_way COMMIT
  [[ -n $1 ]] && git cat-file -e "$1^{commit}" 2>/dev/null || return 0
  LC_ALL=C comm -12 <(git ls-files --others --exclude-standard | LC_ALL=C sort) <(git ls-tree -r --name-only "$1" | LC_ALL=C sort) | head -3 | paste -sd ' ' -
}
# For update.sh: git writes over no file it does not track and refuses only at the merge or reset, after the pull and the
# copy, so a file in the way of the release stops the update before anything is fetched
nothing_in_way() { # nothing_in_way COMMIT TAG
  local w; w=$(untracked_in_way "$1")
  [[ -z $w ]] || die "Files that are not in git stand where $2 has its own ($w). Nothing was changed. Move them away, then run again."
}
# update.sh --check-crossing: whether the next update would move this folder to a release on a new history (lib/release.sh), and
# from where. It fetches the tags and asks GitHub, as an update does, and changes nothing else. The image's signature is
# checked when the update runs, before anything moves.
check_crossing() {
  local follow tag target l rc=0
  if on_private; then say "This folder follows the private repository (ops/channel), which moves to no new history. ./scripts/update.sh --check says what the next update installs."; return 0; fi
  [[ $(grep -E '^TALOUS_CHANNEL=' .env 2>/dev/null | tail -1 | cut -d= -f2- || true) != source ]] || { say "TALOUS_CHANNEL=source: this folder follows the source, and the source channel never moves to a new history."; return 0; }
  git fetch --quiet --tags 2>/dev/null || die "Could not reach the remote repository (git fetch failed). Nothing was changed."
  follow=$(release_mode) || die "TALOUS_PRERELEASE in .env is invalid. Allowed: yes, no. Nothing was changed."
  tag=$(release_from_api "$follow") || rc=$?
  ((rc == 0)) || die "Could not ask GitHub for the release to follow. Nothing was changed."
  target=$(git rev-parse -q --verify "refs/tags/$tag^{commit}" 2>/dev/null) || die "Release $tag is not in this folder. Nothing was changed."
  say "This folder: $(git log -1 --format='%h %s'). Release: $tag."
  if [[ $target == "$(git rev-parse HEAD)" ]]; then ok "This folder is on $tag."
  elif git merge-base --is-ancestor HEAD "$target" 2>/dev/null; then ok "$tag continues the history of this folder: an ordinary update."
  elif crosses_from HEAD "$target"; then
    ok "$tag starts a new history that continues $(lineage_of "$target" | cut -d' ' -f1), the release this folder is on. ./scripts/update.sh moves to it once the image's signature is verified, and --rollback can come back."
  elif l=$(lineage_of "$target"); then
    die "$tag continues ${l% *}, and this folder is not on it. Move by hand: git fetch origin && git checkout -B main origin/main && ./scripts/update.sh"
  else die "$tag does not continue this folder."; fi
}
# The release tag (vX.Y.Z) at HEAD when it is above release $1, printed; fails when HEAD is at no such tag. An install on
# a pre-release that the key does not follow (any more) is there.
release_above() {
  local at
  at=$(git tag --points-at HEAD --list 'v[0-9]*' --sort=-v:refname | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' | head -1 || true)
  [[ -n $at && $at != "$1" && $(git tag --list --sort=-v:refname "$at" "$1" | head -1) == "$at" ]] || return 1
  printf '%s\n' "$at"
}
# For update.sh: the release this run follows, in RELEASE_TAG ('' = no release yet). TARGET is the commit the maintenance
# helper chose, and it names the tag in TALOUS_RELEASE; CHANNEL_SETTING is TALOUS_CHANNEL. A source install and a commit the
# helper chose ask nothing. Otherwise GitHub names the release, never the newest git tag, which a pre-release has from its
# first minute. When GitHub does not answer the run stops before anything changes. RELEASE_HELD is the line to say when
# this folder is at a release above the one GitHub names: the run then stays where it is (it must not build the source).
choose_release() { # choose_release TARGET CHANNEL_SETTING
  local follow rc=0 held word=latest
  RELEASE_TAG=''; RELEASE_HELD=''
  follow=$(release_mode) || die "TALOUS_PRERELEASE in .env is invalid. Allowed: yes, no. Nothing was changed."
  if [[ -n ${TALOUS_RELEASE:-} ]]; then
    [[ $TALOUS_RELEASE =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] && git rev-parse -q --verify "refs/tags/$TALOUS_RELEASE^{commit}" >/dev/null || die "Release $TALOUS_RELEASE not found."
    RELEASE_TAG=$TALOUS_RELEASE
  elif [[ -z $1 && $2 != source ]]; then
    RELEASE_TAG=$(release_from_api "$follow") || rc=$?
    ((rc != 3)) || die "GitHub turned the request down: the limit of requests for this address was met. Nothing was changed. Wait an hour and run this again."
    ((rc == 0 || rc == 2)) || die "Could not ask GitHub for the latest release. Nothing was changed."
    [[ -z $RELEASE_TAG ]] || git rev-parse -q --verify "refs/tags/$RELEASE_TAG^{commit}" >/dev/null || die "Release $RELEASE_TAG is not in this folder. Nothing was changed. Check the network and run: git fetch --tags"
    if [[ -n $RELEASE_TAG ]] && held=$(release_above "$RELEASE_TAG"); then
      [[ $follow != newest ]] || word=newest
      RELEASE_HELD="Already on $held, newer than the $word release ($RELEASE_TAG)."
      [[ $follow == newest ]] || RELEASE_HELD+=" TALOUS_PRERELEASE=yes in .env follows releases during their first two days."
      RELEASE_HELD+=" Nothing was changed."
    fi
  fi
}
# For update.sh: the whole choice of what an update installs, with choose_release. Sets prev_commit, CHANNEL, target
# (the commit) and tag (the release, '' on the source channel) for the caller, which declares target and tag local. When this folder stays where it is (a pre-release above the release GitHub names),
# RELEASE_HELD is set and said, and the caller changes nothing.
pick_target() {
  local upstream='' setting
  if on_private; then pick_private; return 0; fi
  [[ $MODE != private ]] || die "The maintenance helper chose the private channel, and ops/channel does not name it. Nothing was changed."
  [[ -n $TARGET ]] || git fetch --quiet --tags 2>/dev/null || die "Could not reach the remote repository (git fetch failed). Nothing was changed, the current version is running. Check the network (git remote -v; git ls-remote origin) and run this again."
  prev_commit=$(git rev-parse HEAD)
  if [[ -n $TARGET ]]; then
    git cat-file -e "$TARGET^{commit}" 2>/dev/null || die "Commit $TARGET is not in this folder."
  else
    upstream=$(git rev-parse '@{u}' 2>/dev/null) || die "The branch has no upstream branch (git branch -u origin/<branch>)."
  fi

  # Which channel: releases once one exists and this checkout is not ahead of it, else the source
  CHANNEL=source
  target=$upstream
  setting=$(channel_setting)
  choose_release "$TARGET" "$setting"; tag=$RELEASE_TAG # lib/release.sh: the release the helper checked, else the one GitHub names
  if [[ -n $TARGET ]]; then
    # the helper chose the commit and the channel; the .env setting may only agree
    [[ -z $setting || $setting == "$MODE" ]] || die "TALOUS_CHANNEL ($setting) does not match the maintenance helper choice ($MODE). Nothing was changed."
    if [[ $MODE == release ]]; then
      [[ -n $tag ]] || die "No release was given."
      [[ $(git rev-parse "refs/tags/$tag^{commit}" 2>/dev/null) == "$TARGET" ]] || die "Release $tag does not point at the checked commit."
    fi
    [[ $MODE == source ]] && tag=''
    CHANNEL=$MODE; target=$TARGET
    if [[ $MODE == release ]]; then continues HEAD "$target"; else git merge-base --is-ancestor HEAD "$target" 2>/dev/null; fi \
      || die "The checked commit does not continue the history of this folder. Nothing was changed."
    say "Channel: $MODE${tag:+ $tag}"
  else
  case $setting in
    source) ;;
    release)
      [[ -n $tag ]] || die "TALOUS_CHANNEL=release is set but there are no releases yet."
      CHANNEL=release ;;
    '')
      if [[ -n $tag ]] && continues HEAD "$tag^{commit}"; then CHANNEL=release; fi ;;
    *) die "TALOUS_CHANNEL is invalid ($setting). Allowed: source, release." ;;
  esac
  [[ -z $RELEASE_HELD ]] || { say "$RELEASE_HELD"; return 0; } # on a pre-release above the one GitHub names: the caller stays (lib/release.sh)
  if [[ $CHANNEL == release ]]; then
    target=$(git rev-parse "$tag^{commit}")
    # a tag pushed on a side branch is not a release: its commit has to be on the branch this clone follows
    git merge-base --is-ancestor "$target" "$upstream" 2>/dev/null || die "The code of release $tag is not on the branch this clone follows. Nothing was changed."
    continues HEAD "$target" || die "This folder is newer than the latest release ($tag). Use the source channel: add the line TALOUS_CHANNEL=source to .env."
    say "Channel: release $tag"
  fi
  fi
}
