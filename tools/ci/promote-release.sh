#!/usr/bin/env bash
# tools/ci/promote-release.sh: promotes the newest release when it is a pre-release that has waited long enough.
# release.yml creates every release as a pre-release, which /releases/latest (what installs read) skips. This ends the
# wait. .github/workflows/promote.yml runs it every six hours; a person with gh signed in can run it too. One release
# at most per run, and only when all of these hold:
#   1. it is the highest version of ALL the releases, drafts included, and it is a pre-release. A draft is held and is
#      never promoted, and it holds the line: while the highest release is a draft, nothing older is promoted either
#      (a hold on 0.9.1 must not let a 0.9.0 that was waiting go out instead)
#   2. it was published 48 hours ago or more
#   3. it is above the release now marked latest
#   4. its image verifies with scripts/lib/release.sh, the check installs run (cosign, else Docker for the pinned one)
#   5. it is still waiting just before the edit (not held, pulled or promoted meanwhile)
# Then: gh release edit TAG --prerelease=false --latest. Anything else prints one line saying why and exits 0, so a
# run that has nothing to do is green. Exit 1 only when GitHub cannot be read or the edit itself fails.
# Hold a release: gh release edit TAG --draft. Pull it: gh release delete TAG. Promote it early: the line above.
# GH_REPO names the repository (default: the public one). PROMOTE_NOW (epoch seconds) replaces the clock, for tests.
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
REPO=${GH_REPO:-jouni-mikkola/omatalous}
export GH_REPO=$REPO
WAIT_HOURS=48
NOW=${PROMOTE_NOW:-$(date +%s)}

say() { printf 'promote: %s\n' "$*"; }
die() { printf 'promote: %s\n' "$*" >&2; exit 1; }
# on a GitHub run this is also an annotation on the run's page, so a release that cannot be promoted is seen
warn() { if [[ ${GITHUB_ACTIONS:-} == true ]]; then printf '::warning::promote: %s\n' "$*"; else say "$*"; fi; }
[[ $NOW =~ ^[0-9]+$ ]] || die "PROMOTE_NOW is not a number of seconds: $NOW"

list=$(gh api "repos/$REPO/releases?per_page=100" 2>&1) || die "cannot list the releases of $REPO: ${list:0:300}"
# the highest version (numerically: 0.10.0 is above 0.9.0) of ALL releases named vX.Y.Z, drafts included, and what it is
pick=$(jq -r '
  [.[] | select(.tag_name | test("^v[0-9]+\\.[0-9]+\\.[0-9]+$"))]
  | sort_by(.tag_name[1:] | split(".") | map(tonumber)) | last // empty
  | [.tag_name, (if .draft then "draft" elif .prerelease then "pre" else "release" end),
     (.published_at // "" | if . == "" then 0 else fromdateiso8601 end), .id] | @tsv' <<<"$list") || die "cannot read the release list of $REPO"
if [[ -z $pick ]]; then say "no pre-release waits in $REPO"; exit 0; fi
IFS=$'\t' read -r tag kind published id <<<"$pick"
case $kind in
  draft) say "no pre-release waits: $tag is held (a draft) and holds the line, so nothing older is promoted while it exists"; exit 0 ;;
  release) say "no pre-release waits in $REPO: the highest release, $tag, is promoted already"; exit 0 ;;
esac
((published > 0)) || { say "$tag has no publish time on GitHub, so it is not promoted"; exit 0; }

age=$((NOW - published))
if ((age < WAIT_HOURS * 3600)); then
  left=$(((WAIT_HOURS * 3600 - age + 3599) / 3600))
  say "$tag was published $((age / 3600)) hours ago and waits until it is $WAIT_HOURS hours old (about $left h more)"
  exit 0
fi

if out=$(gh api "repos/$REPO/releases/latest" 2>&1); then
  latest=$(jq -r '.tag_name // empty' <<<"$out") || die "cannot read the latest release of $REPO"
elif [[ $out == *"HTTP 404"* ]]; then
  latest=
else
  die "cannot read the latest release of $REPO: ${out:0:300}"
fi
if [[ -n $latest ]]; then
  [[ $latest != "$tag" ]] || { say "$tag is the latest release already"; exit 0; }
  if [[ $(printf '%s\n%s\n' "${latest#v}" "${tag#v}" | sort -V | tail -n 1) != "${tag#v}" ]]; then
    say "$tag is not above the latest release $latest, so it is not promoted. It is stale: delete it (gh release delete $tag)"
    exit 0
  fi
fi

# the commit the tag names is the one the image must have been signed for
commit=$(gh api -H 'Accept: application/vnd.github.sha' "repos/$REPO/commits/$tag" 2>&1) || die "cannot read the commit of $tag: ${commit:0:300}"
[[ $commit =~ ^[0-9a-f]{40}$ ]] || die "the commit of $tag is \"${commit:0:80}\", not a sha"
# shellcheck source=scripts/lib/release.sh
. "$ROOT/scripts/lib/release.sh"
ref=$REGISTRY_IMAGE:${tag#v}
if ! verify_signature "$ref" "$commit"; then
  warn "$tag is not promoted: $ref does not verify for commit ${commit:0:7} (cosign refused it, or could not run: it needs cosign or Docker, and the network). Hold it (gh release edit $tag --draft) or look at the release run."
  exit 0
fi

# a hold is made by hand and may come while the image was being checked: it wins. A draft has no release by tag.
now_state=$(gh api "repos/$REPO/releases/tags/$tag" 2>&1) || now_state=
if [[ $(jq -r '[.id, .draft, .prerelease] | @tsv' <<<"${now_state:-null}" 2>/dev/null || true) != "$id"$'\tfalse\ttrue' ]]; then
  say "$tag is no longer a waiting pre-release (held, pulled or promoted meanwhile), so nothing is promoted"
  exit 0
fi

out=$(gh release edit "$tag" --prerelease=false --latest 2>&1) || die "cannot promote $tag: ${out:0:300}"
say "promoted $tag: published $((age / 3600)) hours ago, ${latest:+above $latest, }signed for commit ${commit:0:7}"
