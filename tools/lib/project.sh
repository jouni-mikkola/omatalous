# shellcheck shell=bash
# The project's identity from project.json (a flat file, one "key": "value" per line). Sourced by the release tools,
# which run in a checkout. scripts/lib/release.sh, which an install runs, holds copies that
# tools/test/project-identity.test.ts compares with this file. Plain bash, so it runs with the thinnest PATH.

project_value() { # project_value KEY: the value, or nothing
  local line
  while IFS= read -r line; do
    [[ $line =~ ^\ *\"$1\":\ *\"([^\"]*)\",?$ ]] && { printf '%s' "${BASH_REMATCH[1]}"; return 0; }
  done <"${PROJECT_JSON:-${BASH_SOURCE[0]%/*}/../../project.json}"
  return 0
}
PROJECT_OWNER=$(project_value owner)
PROJECT_REPO=$(project_value repo)
PROJECT_IMAGE=$(project_value image)
[[ -n $PROJECT_OWNER && -n $PROJECT_REPO && -n $PROJECT_IMAGE ]] || { echo "project.json is missing or incomplete." >&2; exit 1; }
