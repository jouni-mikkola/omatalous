#!/usr/bin/env bash
# The docker of the proof: every image the proof builds is built with no test run, and with PROOF_BUILD_CA=FILE its build
# stage trusts that CA, for a machine whose HTTPS proxy re-signs TLS (a cloud sandbox: `pnpm fetch` there stops on
# SELF_SIGNED_CERT_IN_CHAIN).
#
#   tools/ci/build-ca.sh setup DIR   copies this script, as `docker`, and the CA when PROOF_BUILD_CA names one, into
#                                    DIR/build-ca and prints that folder, which the caller puts first in PATH
#                                    (tools/ci/lib.sh build_ca, local-proof.sh)
#   DIR/build-ca/docker ARGS...      docker itself, with the Dockerfile rewritten for `docker build` and for a compose
#                                    build, up, run or create
#
# The baselines' old update.sh and install.sh build through `docker compose`, and their files must stay as they are (an
# update checks a clean tree), so the rewrite reaches their builds through PATH and not through the clone. The Dockerfile
# is read and given to docker from outside the context: `docker build -f -`, or for compose an override file whose
# dockerfile is a copy. A Dockerfile with nothing to rewrite and no CA to add is docker's own, untouched.
#
# No tests: the baselines before 0.4.0 run `RUN pnpm test && pnpm build`, the old version's whole suite, in every build of
# their image. Those tests passed when that version shipped and prove nothing about an update, and under load one of them
# hit its timeout and failed a proof. That line becomes `RUN pnpm build`. Every later Dockerfile, the one under proof among
# them, runs its tests only with the build argument RUN_TESTS=true, which nothing of the proof passes, so its builds run no
# tests as they are. Any other line that runs `pnpm test` builds as it is, and one line on stderr says so.
#
# PROOF_BUILD_CA: with the CA as the extra context `ca`, after the `FROM ... AS build` line come
#   COPY --from=ca build-ca.crt /etc/ssl/build-ca.crt
#   ENV NODE_EXTRA_CA_CERTS=/etc/ssl/build-ca.crt
# so only the build stage trusts it and the final stage, the image that is proved, holds no CA. A Dockerfile with no such
# stage is refused, since its build would fail on the proxy later and less clearly. The containers the proof starts make
# no call outside, so they need no CA.
set -euo pipefail

if [[ ${1:-} == setup && $(basename "$0") != docker ]]; then
  dir=${2:?usage: build-ca.sh setup DIR}/build-ca
  [[ -z ${PROOF_BUILD_CA:-} || (-f $PROOF_BUILD_CA && -r $PROOF_BUILD_CA) ]] || { echo "PROOF_BUILD_CA names no file that can be read: $PROOF_BUILD_CA" >&2; exit 2; }
  real=$(command -v docker) || { echo "docker is not installed." >&2; exit 2; }
  mkdir -p "$dir"
  # the legs run as other users: the folder, the CA and the script are theirs to read
  [[ -z ${PROOF_BUILD_CA:-} ]] || install -m 644 "$PROOF_BUILD_CA" "$dir/build-ca.crt"
  install -m 755 "$0" "$dir/docker"
  printf '%s\n' "$real" >"$dir/real"
  chmod 755 "$dir" && chmod 644 "$dir/real"
  echo "$dir"
  exit 0
fi

HERE=$(cd "$(dirname "$0")" && pwd)
REAL=$(cat "$HERE/real")
CA=$HERE/build-ca.crt
[[ -f $CA ]] || CA=''
die() { echo "PROOF_BUILD_CA: $*" >&2; exit 1; }
# the one test line this docker rewrites, the form of the baselines before 0.4.0
NO_TESTS='^RUN pnpm test && pnpm build$'
# rewrite FILE: 0 when the build needs the rewritten Dockerfile (a CA to add, or a test run to take out), else 1. One line on
# stderr for a test run in a form it does not know.
rewrite() {
  [[ -f $1 ]] || die "there is no Dockerfile $1."
  if [[ -n $CA ]]; then
    grep -E '^FROM .* AS build$' "$1" >/dev/null || die "$1 has no 'FROM ... AS build' stage, so the CA cannot reach its build."
  fi
  # shellcheck disable=SC2016 # the words of the Dockerfile, not an expansion
  if grep -E 'pnpm test' "$1" | grep -vE "$NO_TESTS" | grep -vF '"$RUN_TESTS" = true' | grep -vE '^[[:space:]]*#' >/dev/null; then
    echo "proof docker: $1 runs pnpm test in a form this docker does not rewrite, so its build runs the tests" >&2
  fi
  [[ -n $CA ]] || grep -E "$NO_TESTS" "$1" >/dev/null
}
# patched FILE: the Dockerfile with no test run and with the CA after the line that starts the build stage, on stdout
patched() {
  awk -v ca="$CA" -v no_tests="$NO_TESTS" '
    $0 ~ no_tests { print "RUN pnpm build"; next }
    { print }
    ca != "" && /^FROM .* AS build$/ { print "COPY --from=ca build-ca.crt /etc/ssl/build-ca.crt"; print "ENV NODE_EXTRA_CA_CERTS=/etc/ssl/build-ca.crt" }' "$1"
}
TMP=''
trap '[[ -z $TMP ]] || rm -rf "$TMP"' EXIT
# context: the folder of the rewritten Dockerfile and the CA, under the name the patched Dockerfile copies
context() { TMP=$(mktemp -d "${TMPDIR:-/tmp}/build-ca.XXXXXX"); [[ -z $CA ]] || cp "$CA" "$TMP/build-ca.crt"; }

# docker build [OPTIONS] CONTEXT: the context is the last word, as every build of the proof writes it
if [[ ${1:-} == build ]]; then
  args=("$@")
  ctx=${args[-1]}
  if [[ $# -lt 2 || $ctx == - || $ctx == *://* || ! -d $ctx ]]; then exec "$REAL" "$@"; fi
  file=$ctx/Dockerfile
  out=()
  for ((i = 0; i < ${#args[@]} - 1; i++)); do
    case ${args[i]} in
      -f | --file) file=${args[i + 1]}; i=$((i + 1)) ;;
      --file=*) file=${args[i]#--file=} ;;
      *) out+=("${args[i]}") ;;
    esac
  done
  [[ $file == - ]] && exec "$REAL" "$@" # a Dockerfile on stdin is the caller's own, written for no network
  rewrite "$file" || exec "$REAL" "$@"
  context
  patched "$file" >"$TMP/Dockerfile"
  extra=()
  [[ -z $CA ]] || extra=(--build-context "ca=$TMP")
  "$REAL" "${out[@]}" -f - "${extra[@]}" "$ctx" <"$TMP/Dockerfile"
  exit
fi

# docker compose [GLOBAL OPTIONS] COMMAND ...: the commands that can build get an override file after the project's own
if [[ ${1:-} == compose ]]; then
  args=("${@:2}")
  project=$PWD files=0 cmd='' at=0
  for ((i = 0; i < ${#args[@]}; i++)); do
    case ${args[i]} in
      -f | --file) files=1; at=$((i + 2)); i=$((i + 1)) ;;
      --project-directory) project=${args[i + 1]}; i=$((i + 1)) ;;
      -p | --project-name | --env-file | --profile | --ansi | --progress | --parallel) i=$((i + 1)) ;;
      -*) ;;
      *) cmd=${args[i]}; break ;;
    esac
  done
  case $cmd in build | up | run | create) ;; *) exec "$REAL" "$@" ;; esac
  [[ -f $project/Dockerfile ]] || exec "$REAL" "$@"
  rewrite "$project/Dockerfile" || exec "$REAL" "$@"
  context
  patched "$project/Dockerfile" >"$TMP/Dockerfile"
  project=$(cd "$project" && pwd)
  # every baseline's docker-compose.yml builds the one service banking from its folder
  printf 'services:\n  banking:\n    build:\n      context: %s\n      dockerfile: %s\n' "$project" "$TMP/Dockerfile" >"$TMP/compose.yml"
  [[ -z $CA ]] || printf '      additional_contexts:\n        ca: %s\n' "$TMP" >>"$TMP/compose.yml"
  if ((files)); then
    "$REAL" compose "${args[@]:0:at}" -f "$TMP/compose.yml" "${args[@]:at}"
  else
    COMPOSE_FILE=${COMPOSE_FILE:-docker-compose.yml}${COMPOSE_PATH_SEPARATOR:-:}$TMP/compose.yml "$REAL" "$@"
  fi
  exit
fi

exec "$REAL" "$@"
