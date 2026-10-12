#!/usr/bin/env bash
# Omatalous install command. README.md and docs/INSTALL.md tell a household to download this file, check its sha256
# against the one printed there and run it:
#
#   bash omatalous-install.sh [--dir FOLDER] [--new-instance NAME] [installer options]
#
# It installs nothing itself. It asks GitHub for the newest release of Omatalous, clones the repository, puts the
# clone on that release and hands over to the installer in the clone: scripts/install.sh --install-docker.
#
#   --dir FOLDER          where the clone goes (default: ~/omatalous)
#   --new-instance NAME   a second copy: clones into ~/NAME and installs it as instance NAME
#   anything else         handed to scripts/install.sh (--yes, --port 8085, --access lan, see the top of that script)
#
# In this order:
#   1. Stops when run as root. Needs curl and git, and offers to install them with apt.
#   2. A folder that is already a clone of the same repository: its own installer runs and nothing else happens.
#      Any other thing in the way stops the script.
#   3. Asks GitHub for the latest release, a tag vX.Y.Z (GitHub never calls a pre-release the latest). No release or
#      no answer: it stops and prints the commands to run by hand.
#   4. Clones into a scratch folder next to the target, moves main to the release's commit and only when that commit
#      is on origin/main puts the clone in place. An error or Ctrl-C before that leaves nothing behind.
#   5. Runs scripts/install.sh --install-docker with the terminal as input.
#
# All the work is in main(), which the last line calls with an end marker. A download that was cut short either does
# not parse or lacks the marker, so it runs nothing. The test hooks (TALOUS_API, TALOUS_REPO, TALOUS_TTY) work only
# with OPS_TEST=1. Tests: tools/test/bootstrap.test.sh.
set -euo pipefail

say() { printf '%s\n' "$*"; }
die() { printf 'Error: %s\n' "$*" >&2; exit 1; }
cleanup() { [[ -z ${SCRATCH:-} ]] || rm -rf -- "$SCRATCH"; }

usage() {
  printf '%s\n' \
    'Usage: bash omatalous-install.sh [--dir FOLDER] [--new-instance NAME] [installer options]' \
    '  --dir FOLDER          where the clone goes (default: ~/omatalous)' \
    '  --new-instance NAME   a second copy: clones into ~/NAME and installs it as instance NAME' \
    '  anything else         handed to scripts/install.sh, for example --yes or --port 8085'
}

# The terminal can be read even when stdin is the script itself (curl ... | bash).
has_tty() { ( : <"$TTY_DEV" ) 2>/dev/null; }
# confirm QUESTION: Enter or y is yes. --yes answers yes, no terminal answers no.
confirm() {
  local answer=""
  if $YES; then return 0; fi
  has_tty || return 1
  printf '%s [Y/n] ' "$1" >&2
  read -r answer <"$TTY_DEV" || return 1
  [[ -z $answer || $answer == [yY]* ]]
}

# Needs curl and git. On an apt system it offers to install what is missing.
need_tools() {
  local cmd list command_line
  local -a missing=() sudo=(sudo)
  for cmd in curl git; do command -v "$cmd" >/dev/null || missing+=("$cmd"); done
  if ((${#missing[@]} == 0)); then return 0; fi
  list="${missing[*]}"
  command_line="sudo apt-get update && sudo apt-get install -y $list"
  if command -v apt-get >/dev/null && command -v sudo >/dev/null; then
    if $YES; then sudo=(sudo -n); fi
    say "Missing: $list. This installs it:  $command_line"
    if confirm "Run it now?"; then
      if "${sudo[@]}" apt-get update </dev/null; then "${sudo[@]}" apt-get install -y "${missing[@]}" </dev/null || true; fi
    fi
  fi
  for cmd in "${missing[@]}"; do
    command -v "$cmd" >/dev/null || die "$cmd is missing. Install it (on Ubuntu: $command_line) and run this again."
  done
}

# without a trailing slash or .git, so that two spellings of one address compare equal
plain_url() { local u=${1%/}; printf '%s' "${u%.git}"; }
# Is $1 a clone of this repository? A folder inside some other repository does not count.
is_our_clone() {
  local have
  [[ -e $1/.git ]] || return 1
  have=$(git -C "$1" config --get remote.origin.url 2>/dev/null </dev/null) || return 1
  [[ $(plain_url "$have") == "$(plain_url "$REPO_URL")" ]]
}

# Sets TAG to the latest release (vX.Y.Z) and returns 0, or sets WHY and returns 1.
latest_release() {
  local body code
  TAG=""
  WHY="GitHub's answer holds no release of the form vX.Y.Z."
  body=$(mktemp) || die "Could not make a temporary file."
  code=$(curl -sS --proto "$PROTO" --proto-redir "$PROTO" --tlsv1.2 --location --max-redirs 3 \
    --connect-timeout 10 --max-time 30 --max-filesize 2000000 \
    -H 'Accept: application/vnd.github+json' -H 'X-GitHub-Api-Version: 2022-11-28' -A omatalous-install \
    -o "$body" -w '%{http_code}' "$API_URL" 2>/dev/null </dev/null) || code=000
  case $code in
    200)
      if grep -q '"prerelease": *true' "$body"; then
        WHY="The newest release is marked as a pre-release, so it is not installed."
      else
        TAG=$(grep -o '"tag_name": *"v[0-9]\+\.[0-9]\+\.[0-9]\+"' "$body" | head -n 1 | sed -E 's/.*"(v[0-9.]+)"$/\1/') || true
      fi ;;
    404) WHY="Omatalous has no release yet." ;;
    000) WHY="GitHub did not answer. Check the network connection (curl -I https://api.github.com)." ;;
    *) WHY="GitHub answered with HTTP $code instead of the latest release." ;;
  esac
  rm -f "$body"
  [[ $TAG =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]
}

# Clones the repository to DIR at release $1, or stops with nothing left behind. The clone is built next to DIR
# and moved into place last, so a folder named DIR is a clone that was checked.
fetch_release() {
  local tag=$1 parent clone commit
  parent=$(dirname -- "$DIR")
  mkdir -p -- "$parent" || die "Could not create $parent."
  SCRATCH=$(mktemp -d "$parent/.omatalous-clone.XXXXXX") || die "Could not write in $parent."
  clone=$SCRATCH/clone
  say "Cloning $REPO_URL"
  GIT_TERMINAL_PROMPT=0 GIT_ALLOW_PROTOCOL=$GIT_PROTO git clone --quiet -- "$REPO_URL" "$clone" </dev/null \
    || die "Could not clone $REPO_URL. Check the network connection (curl -I https://github.com) and run this again."
  commit=$(git -C "$clone" rev-parse --verify --quiet "refs/tags/$tag^{commit}" </dev/null) \
    || die "The release $tag is not in the repository. Nothing was installed."
  git -C "$clone" rev-parse --verify --quiet refs/remotes/origin/main >/dev/null </dev/null \
    || die "The repository has no main branch. Nothing was installed."
  git -C "$clone" merge-base --is-ancestor "$commit" refs/remotes/origin/main </dev/null \
    || die "The release $tag (commit ${commit:0:12}) is not on the main branch, so it is not installed."
  git -C "$clone" checkout --quiet -B main "$commit" </dev/null \
    || die "Could not check out the release $tag. Nothing was installed."
  # -T: DIR becomes the clone, also when DIR is an empty folder, and never receives it as a subfolder
  mv -T -- "$clone" "$DIR" || die "Could not move the clone to $DIR."
  rmdir -- "$SCRATCH"
  SCRATCH=""
}

# The installer of the clone takes over, with the terminal as input when stdin is the script.
hand_over() {
  [[ -x $DIR/scripts/install.sh ]] || die "$DIR/scripts/install.sh is missing, so the folder is not a usable clone. Move it away and run this again."
  cd -- "$DIR"
  if [[ ! -t 0 ]] && has_tty; then exec ./scripts/install.sh --install-docker "$@" <"$TTY_DEV"; fi
  exec ./scripts/install.sh --install-docker "$@"
}

main() {
  # The last argument is the marker that the last line of the file adds.
  if (($# == 0)) || [[ ${!#} != --end-of-script ]]; then
    printf 'Error: this script is incomplete, so nothing was done. Download it again.\n' >&2
    exit 1
  fi
  set -- "${@:1:$#-1}"
  SCRATCH=""
  trap cleanup EXIT

  API_URL=https://api.github.com/repos/jouni-mikkola/omatalous/releases/latest
  REPO_URL=https://github.com/jouni-mikkola/omatalous.git
  PROTO='=https'; GIT_PROTO=https; TTY_DEV=/dev/tty
  if [[ ${OPS_TEST:-} == 1 ]]; then
    API_URL=${TALOUS_API:-$API_URL}; REPO_URL=${TALOUS_REPO:-$REPO_URL}; TTY_DEV=${TALOUS_TTY:-$TTY_DEV}
    PROTO='=https,http,file'; GIT_PROTO=https:file
  fi
  YES=false; DIR=""; NAME=""
  local -a opts=()

  [[ $(id -u) != 0 ]] || die "Run this as your normal user, not as root. The installer asks for sudo when it needs it."
  while (($#)); do
    case $1 in
      -h | --help) usage; exit 0 ;;
      --dir | --new-instance)
        if (($# < 2)) || [[ $2 == -* ]]; then usage >&2; die "$1 needs a value."; fi
        if [[ $1 == --dir ]]; then DIR=$2; else NAME=$2; fi
        shift ;;
      --yes | -y) YES=true; opts+=("$1") ;;
      *) opts+=("$1") ;;
    esac
    shift
  done
  [[ -z $NAME || $NAME =~ ^[a-z0-9][a-z0-9_-]{0,40}$ ]] \
    || die "The name must use lowercase letters, digits, - or _ (start with a letter or digit, at most 41 characters)."
  [[ -z $NAME ]] || opts+=(--name "$NAME")
  if [[ -z $DIR ]]; then
    [[ -n ${HOME:-} && -d $HOME ]] || die "HOME is not set. Pick a folder: bash omatalous-install.sh --dir FOLDER"
    DIR=$HOME/${NAME:-omatalous}
  fi
  case $DIR in /*) ;; *) DIR=$PWD/$DIR ;; esac
  while [[ $DIR == */ && $DIR != / ]]; do DIR=${DIR%/}; done
  [[ $DIR != / ]] || die "Pick a folder for the clone: bash omatalous-install.sh --dir FOLDER"

  need_tools
  if [[ -e $DIR || -L $DIR ]]; then
    if is_our_clone "$DIR"; then
      say "$DIR is already a clone of Omatalous. Running its installer."
      hand_over ${opts[@]+"${opts[@]}"}
    fi
    [[ -d $DIR && ! -L $DIR && -z $(ls -A -- "$DIR" 2>/dev/null) ]] \
      || die "$DIR exists and is not a clone of Omatalous. Pick another folder: bash omatalous-install.sh --dir FOLDER"
  fi

  if ! latest_release; then
    printf 'Error: %s Nothing was installed.\nTo install by hand:\n  git clone %s %q\n  cd %q\n  ./scripts/install.sh --install-docker%s\n' \
      "$WHY" "$REPO_URL" "$DIR" "$DIR" "${NAME:+ --name $NAME}" >&2
    exit 1
  fi
  say "Latest release: $TAG"
  fetch_release "$TAG"
  say "Release $TAG is in $DIR. Starting the installer."
  hand_over ${opts[@]+"${opts[@]}"}
}

main "$@" --end-of-script
