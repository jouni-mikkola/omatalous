#!/usr/bin/env bash
# tools/ci/release-plan.sh
# The plan job of .github/workflows/release.yml: which version this run releases or builds, if any, and that the tree
# agrees with it. Run from the root of the checkout (full history and tags); writes `name=value` lines to $GITHUB_OUTPUT:
#   release   true when this run signs and releases (main, a tag), false otherwise
#   dry_run   true for a rehearsal started by hand
#   candidate true when this run only builds and tests the images of a version that main moves to later
#   version, tag, new_tag   the version X.Y.Z, its tag vX.Y.Z, and whether the release creates that tag
# A run on a candidate branch candidate/X.Y.Z-<short> builds and signs nothing public: the version is the branch name's
# and must be the tree's; the commit has exactly one parent, and it is origin/main; no tag and no release of that version
# exists. Every other check is the one a run on main makes.
# Input (environment): EVENT REF REF_NAME SIGNED_BY_HAND DRY_RUN GH_REPO, and gh with GH_TOKEN. Exit code 0 or 1.
# No pipefail: the workflow step ran without it, and `sed ... | head -1` on the changelog would end in SIGPIPE with it.
set -eu

# every tag, read once: a `git tag` that fails must stop the plan, not read as "no tag" (the checks below ask this list)
tags=$(git tag --list) || { echo "git tag failed"; exit 1; }

app=$(sed -n 's/^export const APP_VERSION = "\(.*\)";$/\1/p' apps/server/src/version.ts)
candidate=false
if [[ $EVENT == workflow_dispatch && $DRY_RUN == true ]]; then
  # A rehearsal builds and smoke tests the version in the tree, whether it has a tag or not. It pushes, signs
  # and releases nothing, so it needs no free version and no signed_by_hand.
  [[ $REF == refs/heads/main ]] || { echo "Run it on main, not $REF"; exit 1; }
  [[ $app =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "APP_VERSION is \"$app\", not X.Y.Z"; exit 1; }
  {
    echo "release=false"
    echo "dry_run=true"
    echo "version=$app"
    echo "tag=v$app"
  } >>"$GITHUB_OUTPUT"
  echo "Dry run of $app: both images are built and smoke tested. Nothing is pushed, signed or released." >>"$GITHUB_STEP_SUMMARY"
  exit 0
fi
if [[ $EVENT == workflow_dispatch && $SIGNED_BY_HAND != true ]]; then
  echo "Installs before 0.5.1 refuse a release started by hand. Push the new version to main or re-run the failed run."
  exit 1
fi
if [[ $REF == refs/heads/main ]]; then
  # on main the version in the tree names the release, which is new only while it has no tag
  TAG=v$app; new_tag=true
  if grep -qxF "$TAG" <<<"$tags"; then
    [[ $EVENT == push ]] || { echo "Tag $TAG exists already. Bump the version first."; exit 1; }
    # a publish with --tag pushes main and the tag at once, and the tag's run makes the release
    echo "$TAG has a tag already, nothing to do on main."
    echo "release=false" >>"$GITHUB_OUTPUT"
    exit 0
  fi
elif [[ $REF == refs/heads/candidate/* ]]; then
  [[ $EVENT == push ]] || { echo "A candidate is built by a push to its branch, not by $EVENT."; exit 1; }
  re='^candidate/([0-9]+\.[0-9]+\.[0-9]+)-[0-9a-f]{7,40}$'
  [[ $REF_NAME =~ $re ]] || { echo "Branch $REF_NAME is not candidate/X.Y.Z-<commit>"; exit 1; }
  TAG=v${BASH_REMATCH[1]}; new_tag=false; candidate=true
  # the commit is the one public main moves to: one parent, and that parent is main as this checkout has it
  parent=$(git rev-parse --verify --quiet 'HEAD^' || true)
  main=$(git rev-parse --verify --quiet 'origin/main' || true)
  [[ -n $parent && $parent == "$main" ]] || { echo "The parent of the candidate is \"${parent:-none}\", not origin/main (${main:-missing})"; exit 1; }
  git rev-parse --verify --quiet 'HEAD^2' >/dev/null && { echo "The candidate commit is a merge"; exit 1; }
  ! grep -qxF "$TAG" <<<"$tags" || { echo "Tag $TAG exists already, so there is no candidate of it."; exit 1; }
elif [[ $EVENT == workflow_dispatch ]]; then
  echo "Run it on main, not $REF"; exit 1
else
  TAG=$REF_NAME; new_tag=false
fi
[[ $TAG =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "Tag $TAG is not vX.Y.Z"; exit 1; }
# a release that exists already (a tag pushed again, a whole re-run) is not built twice; only a 404 means none
if out=$(gh api "repos/$GH_REPO/releases/tags/$TAG" 2>&1); then
  [[ $EVENT == push && $candidate == false ]] || { echo "Release $TAG exists already."; exit 1; }
  echo "Release $TAG exists already, nothing to do."
  echo "release=false" >>"$GITHUB_OUTPUT"
  exit 0
elif [[ $out != *"HTTP 404"* ]]; then
  echo "Could not ask GitHub whether release $TAG exists: $out"; exit 1
fi
version=${TAG#v}
[[ $app == "$version" ]] || { echo "Tag $TAG but APP_VERSION is $app"; exit 1; }
for f in apps/server/package.json apps/web/package.json packages/core/package.json; do
  v=$(node -p "require('./$f').version")
  [[ $v == "$version" ]] || { echo "$f is $v, tag is $version"; exit 1; }
done
top=$(sed -n 's/^## \([^ ]*\).*/\1/p' CHANGELOG.md | head -1)
[[ $top == "$version" ]] || { echo "CHANGELOG top heading is $top, tag is $version"; exit 1; }
[[ $new_tag == true || $candidate == true ]] || grep -qxF "$TAG" <<<"$tags" || { echo "tag missing"; exit 1; }
# the helper updates to GitHub's latest release, so a new one must be above every earlier release
newest=$(grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' <<<"$tags" | grep -vx "$TAG" | sort -V | tail -1 || true)
if [[ -n $newest && $(printf '%s\n' "$newest" "$TAG" | sort -V | tail -1) != "$TAG" ]]; then
  echo "$TAG is not above the newest release $newest"; exit 1
fi
if [[ $candidate == true ]]; then
  {
    echo "release=false"
    echo "dry_run=false"
    echo "candidate=true"
    echo "version=$version"
    echo "tag=$TAG"
    echo "new_tag=false"
  } >>"$GITHUB_OUTPUT"
  echo "Candidate $version: both images are built and smoke tested. Nothing is signed, tagged or released." >>"$GITHUB_STEP_SUMMARY"
  exit 0
fi
{
  echo "release=true"
  echo "dry_run=false"
  echo "version=$version"
  echo "tag=$TAG"
  echo "new_tag=$new_tag"
} >>"$GITHUB_OUTPUT"
