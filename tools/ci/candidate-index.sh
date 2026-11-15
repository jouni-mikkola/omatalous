#!/usr/bin/env bash
# tools/ci/candidate-index.sh
# The index job of .github/workflows/release.yml: checks the index of a candidate's two images and writes the record of
# the candidate. Run from the job after `docker buildx imagetools create --dry-run` printed the index into INDEX_FILE.
# Input (environment):
#   INDEX_FILE  the index as buildx printed it; its bytes, without the newline at the end, are what the digest is of
#   IMAGE       the image name, for the summary line
#   AMD64 ARM64 the digests of the two single-platform images (sha256:<64 hex>), different from each other
#   VERSION     X.Y.Z      SHA the commit (40 hex)      RUN_ID the number of the workflow run
#   OUT         where the record goes (default candidate.json)
# The index must hold exactly linux/amd64 and linux/arm64 (the attestation manifests of the images carry the platform
# unknown/unknown and do not count). Fewer than two attestation manifests is a warning, not a refusal. The digest is
# the sha256 of the printed bytes as they are: nothing may reformat the JSON before it is hashed, or the digest is
# no longer the one the registry gives the index. Exit code 0, or 1 with one line on stderr.
# Every value is checked before it is used and the digest is checked after the pipe that makes it, so a command that
# fails in the middle of a pipe cannot leave a wrong record.
set -euo pipefail

die() { echo "$*" >&2; exit 1; }
one_line() { local s=${1:0:200}; printf '%s' "${s//$'\n'/ }"; }

: "${INDEX_FILE:?INDEX_FILE is not set}" "${IMAGE:?IMAGE is not set}"
AMD64=${AMD64:-}; ARM64=${ARM64:-}; VERSION=${VERSION:-}; SHA=${SHA:-}; RUN_ID=${RUN_ID:-}
out=${OUT:-candidate.json}
for d in "$AMD64" "$ARM64"; do
  [[ $d =~ ^sha256:[0-9a-f]{64}$ ]] || die "A build gave no digest: amd64 \"$AMD64\", arm64 \"$ARM64\""
done
[[ $AMD64 != "$ARM64" ]] || die "Both builds gave the same digest: $AMD64"
[[ $VERSION =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "The version is \"$VERSION\", not X.Y.Z"
[[ $SHA =~ ^[0-9a-f]{40}$ ]] || die "The commit is \"$SHA\", not 40 hex digits"
[[ $RUN_ID =~ ^[0-9]+$ ]] || die "The run number is \"$RUN_ID\", not a number"
[[ -f $INDEX_FILE ]] || die "There is no index at $INDEX_FILE"

manifest=$(<"$INDEX_FILE") # the newline at the end is not part of the index
jq -e '.mediaType | endswith("index.v1+json") or endswith("manifest.list.v2+json")' <<<"$manifest" >/dev/null 2>&1 \
  || die "The index of the two images is not an index: $(one_line "$manifest")"
platforms=$(jq -r '[.manifests[]? | select(.platform.os != "unknown") | "\(.platform.os)/\(.platform.architecture)"] | sort | join(" ")' <<<"$manifest")
[[ $platforms == "linux/amd64 linux/arm64" ]] || die "The index holds \"$platforms\", not linux/amd64 and linux/arm64"
attestations=$(jq '[.manifests[]? | select(.platform.os == "unknown")] | length' <<<"$manifest")
[[ $attestations == 2 ]] || echo "::warning::The index holds $attestations attestation manifests, not one for each image."

sum=$(printf '%s' "$manifest" | sha256sum)
digest=sha256:${sum%% *}
[[ $digest =~ ^sha256:[0-9a-f]{64}$ ]] || die "The digest of the index could not be made"

jq -n --arg version "$VERSION" --arg sha "$SHA" --arg digest "$digest" --arg amd64 "$AMD64" --arg arm64 "$ARM64" --arg run "$RUN_ID" \
  '{schema: 1, version: $version, sha: $sha, digest: $digest, amd64: $amd64, arm64: $arm64, run_id: $run}' >"$out"
cat "$out"
echo "Candidate $VERSION at $SHA: index $digest of $AMD64 and $ARM64 ($IMAGE)" >>"${GITHUB_STEP_SUMMARY:-/dev/null}"
