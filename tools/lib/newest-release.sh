# shellcheck shell=bash
# The rule for a repository whose only releases are pre-releases. GitHub's /releases/latest skips them and a new release
# is one for 48 hours, so a 404 there is no reason to stop: the newest release of any kind is the one to check. Sourced by
# tools/ci/verify-release.sh and tools/ci/drills.sh (drill 10), which each fetch the list their own way. Needs jq.

# newest_release_tag: the tag of the first release of the GitHub release list on stdin (newest first), or nothing for an
# empty list.
newest_release_tag() { jq -r '.[0].tag_name // empty'; }

# no_latest_note REPO TAG: what is said when the newest release stands in for the latest one
no_latest_note() { echo "$1 has no latest release (only pre-releases): checking the newest, $2."; }
