#!/usr/bin/env bash
# tools/ci/verify-release.sh [vX.Y.Z]
# Checks that a published release (by default the one the maintenance helper updates to, GitHub's latest) verifies
# with the signature check installs run: this checkout's scripts/lib/release.sh and the copy in every upgrade
# baseline that has one, because an install runs the check it already has. Also says which trigger
# started the run that signed it. Needs cosign, the full git history and the network.
#
# tools/ci/verify-release.sh --pull X.Y.Z
# Checks that anyone can pull the image: an anonymous token from ghcr, a manifest list for the tag that answers 200 and
# holds linux/amd64 and linux/arm64. Exit 1 when the package needs a login, the tag is not there or an architecture is
# missing. Needs only curl and jq, no cosign and no git history.
set -euo pipefail
ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
cd "$ROOT"

if [[ ${1:-} == --pull ]]; then
  version=${2:-}
  version=${version#v}
  [[ $version =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "usage: verify-release.sh --pull X.Y.Z"; exit 1; }
  image=$(sed -n 's/^REGISTRY_IMAGE=//p' scripts/lib/release.sh)
  host=${image%%/*}
  name=${image#*/}
  token=$(curl -fsS "https://$host/token?service=$host&scope=repository:$name:pull" | jq -r '.token // empty') || token=
  [[ -n $token ]] || { echo "$version: $host gave no anonymous token for $name. The package may be private."; exit 1; }
  body=$(mktemp)
  trap 'rm -f "$body"' EXIT
  code=$(curl -sS -o "$body" -w '%{http_code}' -H "Authorization: Bearer $token" \
    -H 'Accept: application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json' \
    "https://$host/v2/$name/manifests/$version") || { echo "$version: cannot reach $host"; exit 1; }
  case $code in
    200) ;;
    401 | 403) echo "$version: $host wants a login to pull $name:$version ($code). The package is not public."; exit 1 ;;
    404) echo "$version: $name:$version is not on $host (404)."; exit 1 ;;
    *) echo "$version: the manifest of $name:$version answers $code, not 200."; exit 1 ;;
  esac
  # attestation manifests carry the platform unknown/unknown and do not count
  platforms=$(jq -r '[.manifests[]? | select(.platform.os != "unknown") | "\(.platform.os)/\(.platform.architecture)"] | unique | join(" ")' "$body")
  missing=()
  for want in linux/amd64 linux/arm64; do [[ " $platforms " == *" $want "* ]] || missing+=("$want"); done
  if ((${#missing[@]})); then
    echo "$version: the manifest list of $name:$version lacks ${missing[*]} (has: ${platforms:-no platforms, not a manifest list})."
    exit 1
  fi
  echo "$version: $name:$version pulls without a login and holds $platforms."
  exit 0
fi

repo=jouni-mikkola/omatalous
# the first release of a new root (release.sh --new-root, docs/RELEASING.md) has no release before it to verify. Only
# that run says so, and only an empty list from GitHub counts: a failed request is no answer and the check runs as ever.
if (($# == 0)) && [[ ${VERIFY_RELEASE_FIRST:-} == 1 ]] \
  && [[ $(curl -fsS "https://api.github.com/repos/$repo/releases?per_page=1" | jq length) == 0 ]]; then
  echo "No release in $repo yet (the first release of a new root): no signature to verify."
  exit 0
fi
tag=${1:-$(curl -fsS "https://api.github.com/repos/$repo/releases/latest" | jq -r .tag_name)}
[[ $tag =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "No release found in $repo ($tag)"; exit 1; }
# an annotated tag lists its commit as ^{}, a lightweight one (made by the release workflow) only itself
commit=$(git ls-remote "https://github.com/$repo" "refs/tags/$tag^{}" | cut -f1)
[[ -n $commit ]] || commit=$(git ls-remote "https://github.com/$repo" "refs/tags/$tag" | cut -f1)
[[ $commit =~ ^[0-9a-f]{40}$ ]] || { echo "$tag has no commit in $repo"; exit 1; }

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
cp scripts/lib/release.sh "$work/HEAD.sh"
checks=(HEAD)
while read -r base; do
  if git show "$base:scripts/lib/release.sh" >"$work/$base.sh" 2>/dev/null; then checks+=("$base")
  else echo "$base: no release channel, nothing to check"; fi
done < <(grep -vE '^\s*(#|$)' .github/upgrade-from.txt)

# shellcheck source=scripts/lib/release.sh
. "$work/HEAD.sh"
ref=$REGISTRY_IMAGE:${tag#v}

# The verdict is kept by the image's digest: what the registry says the tag is now, the commit, the identity rule, the
# tool that checks and every copy of the check that runs (a change to any of them is a new key and the full check). A
# failed check is never kept, and without a digest nothing is kept or read.
host=${REGISTRY_IMAGE%%/*}
name=${REGISTRY_IMAGE#*/}
digest=
token=$(curl -fsS "https://$host/token?service=$host&scope=repository:$name:pull" | jq -r '.token // empty') || token=
if [[ -n $token ]]; then
  digest=$(curl -fsSI -H "Authorization: Bearer $token" \
    -H 'Accept: application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json' \
    "https://$host/v2/$name/manifests/${tag#v}" | tr -d '\r' \
    | sed -n 's/^[Dd]ocker-[Cc]ontent-[Dd]igest: *\(sha256:[0-9a-f]\{64\}\).*/\1/p' | head -1) || digest=
fi
cache=${VERIFY_RELEASE_CACHE:-$(cd "$(git rev-parse --git-common-dir)" && pwd)/verify-release-cache}
key=
if [[ -n $digest ]]; then
  key=$({ echo "$digest $commit $SIGN_IDENTITY_REGEXP $SIGN_ISSUER ${SIGN_TRIGGERS[*]} ${COSIGN_IMAGE:-}"
    for c in "${checks[@]}"; do echo "$c $(sha256sum <"$work/$c.sh" | cut -c1-64)"; done; } | sha256sum | cut -c1-64)
  if [[ -f $cache ]] && grep -qx "$key" "$cache"; then
    echo "cached: $tag ($digest) was verified before with the same identity rule and the same checks (${#checks[@]} copies)."
    exit 0
  fi
fi

for trigger in "${SIGN_TRIGGERS[@]}"; do
  if cosign_verify "$ref" --certificate-github-workflow-sha "$commit" --certificate-github-workflow-trigger "$trigger"; then
    echo "$tag: signed by a run started by $trigger"
  else
    echo "$tag: not signed by a run started by $trigger"
  fi
done

failed=0
# a copy of the check that is the same file as one already run has that one's verdict (same image, same commit, same code): 70
# baselines hold 4 different copies, and each run is a cosign call over the network (about 4 s each, 5 minutes in all)
declare -A verdict=()
for c in "${checks[@]}"; do
  sum=$(sha256sum <"$work/$c.sh" | cut -c1-64)
  if [[ -z ${verdict[$sum]:-} ]]; then
    # each copy in its own shell, so one version's variables never leak into the next
    # shellcheck source=/dev/null
    if (. "$work/$c.sh" && verify_signature "$ref" "$commit"); then verdict[$sum]=accepts; else verdict[$sum]=refuses; fi
  fi
  if [[ ${verdict[$sum]} == accepts ]]; then
    echo "$c: accepts $tag"
  else
    echo "$c: refuses $tag. Installs with this version cannot update to it."
    failed=1
  fi
done
if ((!failed)) && [[ -n $key ]]; then
  { [[ ! -f $cache ]] || tail -n 19 "$cache"; echo "$key"; } >"$work/cache.new" && cat "$work/cache.new" >"$cache"
fi
exit "$failed"
