# Shared by scripts/update.sh and scripts/install.sh, sourced from the clone root. Needs die, ok and run_logged
# from the caller, and IMAGE (the local image name, <name>:latest is what docker-compose.yml starts).
# shellcheck shell=bash disable=SC2154

# What a released image must be signed by: this project's release workflow, run for a version tag or by hand on main.
# Keep in step with .github/workflows/release.yml (a test compares them).
REGISTRY_IMAGE=ghcr.io/jouni-mikkola/omatalous
SIGN_IDENTITY_REGEXP='^https://github\.com/jouni-mikkola/omatalous/\.github/workflows/release\.yml@refs/(tags/v[0-9]+\.[0-9]+\.[0-9]+|heads/main)$'
SIGN_ISSUER='https://token.actions.githubusercontent.com'
# used when cosign is not installed on the machine; pinned by digest
COSIGN_IMAGE='ghcr.io/sigstore/cosign/cosign:v3.0.6@sha256:de9c65609e6bde17e6b48de485ee788407c9502fa08b8f4459f595b21f56cd00'

latest_release() { git tag --list 'v[0-9]*' --sort=-v:refname | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' | head -1 || true; }
image_label() { docker image inspect -f "{{index .Config.Labels \"$2\"}}" "$1" 2>/dev/null || true; }
# the layout number of docker-compose.yml at a commit (x-talous-compat)
compose_compat() { git show "$1:docker-compose.yml" 2>/dev/null | sed -n 's/^x-talous-compat: *\([0-9][0-9]*\).*/\1/p' | head -1 || true; }
# Checks the signature of an image by digest against this project's release workflow. cosign from the machine if
# there is one, else a pinned cosign image. Fails closed.
verify_signature() { # verify_signature IMAGE_BY_DIGEST COMMIT: also pins the commit the workflow ran on, from a tag push
  local ref=$1 commit=$2 rc=0
  local pin=(--certificate-github-workflow-sha "$commit" --certificate-github-workflow-trigger push)
  if command -v cosign >/dev/null; then
    cosign verify --certificate-identity-regexp "$SIGN_IDENTITY_REGEXP" --certificate-oidc-issuer "$SIGN_ISSUER" "${pin[@]}" "$ref" >/dev/null 2>&1 || rc=$?
  else
    docker run --rm "$COSIGN_IMAGE" verify --certificate-identity-regexp "$SIGN_IDENTITY_REGEXP" --certificate-oidc-issuer "$SIGN_ISSUER" "${pin[@]}" "$ref" >/dev/null 2>&1 || rc=$?
  fi
  return "$rc"
}
# Pulls the release image, verifies it and tags it as $IMAGE:latest. $1 = tag (vX.Y.Z), $2 = the commit it was built from.
fetch_release_image() {
  local version=${1#v} commit=$2 ref digest log rc=0 want have
  ref=$REGISTRY_IMAGE:$version
  log=$(mktemp)
  run_logged "$log" "Pulling" docker pull "$ref" || rc=$?
  if ((rc != 0)); then
    tail -n 5 "$log" | cut -c1-200; rm -f "$log"
    die "Could not pull the image of version $version. Check the network (curl -I https://ghcr.io). ${KEEP_NOTE:-}"
  fi
  rm -f "$log"
  digest=$(docker image inspect -f '{{range .RepoDigests}}{{println .}}{{end}}' "$ref" | grep "^$REGISTRY_IMAGE@sha256:" | head -1 || true)
  [[ -n $digest ]] || die "Could not read the image digest ($ref). ${KEEP_NOTE:-}"
  # the signature is checked on the digest, and the image is used by the same digest
  verify_signature "$digest" "$commit" || die "Could not verify the image signature ($digest). The image is not used. ${KEEP_NOTE:-}"
  ok "Signature verified: $digest"
  [[ $(image_label "$digest" talous.commit) == "$commit" && $(image_label "$digest" talous.version) == "$version" ]] \
    || die "The image does not match release $1 (version or commit differs). The image is not used."
  want=$(compose_compat "$commit"); have=$(image_label "$digest" talous.compose)
  [[ -n $want && $have == "$want" ]] \
    || die "The image expects docker-compose.yml layout $have, the release file has $want. The image is not used."
  docker image tag "$digest" "$IMAGE:latest"
}
