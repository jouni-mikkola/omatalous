#!/usr/bin/env bash
# tools/ci/verify-release.sh [vX.Y.Z]
# Checks that a published release (by default the one the maintenance helper updates to, GitHub's latest) verifies
# with the signature check installs run: this checkout's scripts/lib/release.sh and the copy in every baseline of
# .github/upgrade-from.txt that has one, because an install runs the check it already has. Also says which trigger
# started the run that signed it. Needs cosign, the full git history and the network.
set -euo pipefail
ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
cd "$ROOT"
repo=jouni-mikkola/omatalous
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
for trigger in "${SIGN_TRIGGERS[@]}"; do
  if cosign_verify "$ref" --certificate-github-workflow-sha "$commit" --certificate-github-workflow-trigger "$trigger"; then
    echo "$tag: signed by a run started by $trigger"
  else
    echo "$tag: not signed by a run started by $trigger"
  fi
done

failed=0
for c in "${checks[@]}"; do
  # each copy in its own shell, so one version's variables never leak into the next
  # shellcheck source=/dev/null
  if (. "$work/$c.sh" && verify_signature "$ref" "$commit"); then
    echo "$c: accepts $tag"
  else
    echo "$c: refuses $tag. Installs with this version cannot update to it."
    failed=1
  fi
done
exit "$failed"
