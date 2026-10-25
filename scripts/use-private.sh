#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# Omatalous: switch this folder to follow a private repository, or back to the public releases.
#
#   ./scripts/use-private.sh --repo git@github.com:OWNER/REPO.git   step 1: the deploy key and the remote `private`
#   ./scripts/use-private.sh --check [--follow BRANCH|tags]        step 2: once GitHub has the key, the switch itself
#   ./scripts/use-private.sh --back                                back to the public releases
#
# Step 1 makes an ed25519 key under ~/.config/omatalous/<instance>/ (mode 600) when there is none, prints its public half
# and the GitHub page to add it on as a read-only deploy key, adds the remote `private` (origin and its history stay as
# they are) and points core.sshCommand at the key, with GitHub's host key pinned. Step 2 reads the repository with
# git ls-remote and fetch and only then writes ops/channel, which update.sh and the maintenance helper read
# (lib/release.sh): updates then build what the channel follows (the branch, default main, or the newest vX.Y.Z tag with
# --follow tags) on this machine. --back writes the public channel there and removes the remote and core.sshCommand; the
# next update goes to the newest public release, with its signature check, the migration check and --rollback as usual.
# The key stays, so a later switch needs no new one.
#
# Nothing here reads or writes .env, the volumes, the database or the app secret: the bank keys stay sealed with the app
# secret in the secrets volume, so the banks stay connected. It takes the installer's lock (lib/release.sh).
# ──────────────────────────────────────────────────────────────────────────────
set -euo pipefail
cd "$(dirname "$0")/.."
umask 077

bold=$'\e[1m'; green=$'\e[32m'; red=$'\e[31m'; reset=$'\e[0m'
say() { printf '%s\n' "$*"; }
ok() { printf '%s✓%s %s\n' "$green" "$reset" "$*"; }
die() { printf '%s✗ %s%s\n' "$red" "$*" "$reset" >&2; exit 1; }
usage() { die "Usage: ./scripts/use-private.sh --repo git@github.com:OWNER/REPO.git | --check [--follow BRANCH|tags] | --back"; }

# GitHub's published SSH host key (docs.github.com, GitHub's SSH key fingerprints): the only github.com this key talks to
GITHUB_HOST_KEY='github.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl'
LOCK_WAIT=60

ACTION=''; REPO=''; FOLLOW=''
while (($#)); do
  case $1 in
    --repo) ACTION=repo; REPO=${2:-}; shift ;;
    --check) ACTION=check ;;
    --follow) FOLLOW=${2:-}; shift ;;
    --back) ACTION=back ;;
    *) usage ;;
  esac
  shift
done
[[ -n $ACTION ]] || usage
[[ -z $FOLLOW || $ACTION == check ]] || usage

[[ -d .git && -f scripts/update.sh ]] || die "Run this in the clone folder of an install."
[[ $(id -u) -ne 0 ]] || die "Run this as the user who owns the folder, not as root."
# shellcheck source=lib/release.sh
. scripts/lib/release.sh

# the instance as docker-compose.yml names it: INSTANCE_NAME in .env (read as data), else banking-app
INSTANCE=$(grep -E '^INSTANCE_NAME=' .env 2>/dev/null | tail -1 | cut -d= -f2- || true)
INSTANCE=${INSTANCE:-banking-app}
[[ $INSTANCE =~ ^[a-z0-9][a-z0-9_-]*$ ]] || die "INSTANCE_NAME in .env is invalid: $INSTANCE"
KEYDIR=${XDG_CONFIG_HOME:-$HOME/.config}/omatalous/$INSTANCE
KEY=$KEYDIR/deploy_key
KNOWN=$KEYDIR/known_hosts
[[ $KEYDIR != *"'"* ]] || die "The folder $KEYDIR has a quote in its name."

# one run per folder, with install.sh, update.sh and the helper's actions (ops/.lock)
command -v flock >/dev/null || die "flock is missing (package util-linux)."
installer_lock || die "An install or update is running in this folder. Wait until it finishes."
if [[ -f ops/.lock ]]; then
  exec 8>>ops/.lock
  if ! flock -n 8; then
    say "Waiting for the maintenance helper (at most a minute)…"
    flock -w "$LOCK_WAIT" 8 || die "A maintenance action is running (Asetukset > Ylläpito). Wait until it finishes."
  fi
fi

# the GitHub page for a deploy key of the repository, or nothing for another address
keys_page() {
  [[ $1 =~ ^(git@github\.com:|ssh://git@github\.com/)([A-Za-z0-9_.-]+)/([A-Za-z0-9_.-]+)$ ]] || return 0
  printf 'https://github.com/%s/%s/settings/keys/new\n' "${BASH_REMATCH[2]}" "${BASH_REMATCH[3]%.git}"
}
# ops/channel as one file in one rename (lib/release.sh reads it); ops/ is the helper's folder, mode 700
write_channel() { # write_channel CHANNEL FOLLOW SINCE
  mkdir -p ops && chmod 700 ops
  printf 'CHANNEL=%s\nFOLLOW=%s\nSINCE=%s\n' "$1" "$2" "$3" >ops/channel.new
  chmod 600 ops/channel.new && mv -f ops/channel.new ops/channel
}
# -F /dev/null: the helper runs in a systemd user unit, whose user namespace shows root's files as owned by nobody, and
# ssh then refuses /etc/ssh/ssh_config.d (systemd's ssh proxy file); this command sets all it needs itself
ssh_command() { printf "ssh -F /dev/null -i '%s' -o IdentitiesOnly=yes -o BatchMode=yes -o UserKnownHostsFile='%s' -o StrictHostKeyChecking=yes -o ConnectTimeout=20" "$KEY" "$KNOWN"; }
ours_ssh() { local c; c=$(git config --get core.sshCommand || true); [[ -n $c && ( $c == "$(ssh_command)" || $c == "$(ssh_command | sed "s| -F /dev/null||")" ) ]]; } # this script's command, the one from before -F too

case $ACTION in
  repo)
    [[ $REPO =~ ^(git@github\.com:|ssh://git@github\.com/)[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ || ($REPO =~ ^file:///[A-Za-z0-9_./-]+$ && ${OPS_TEST:-} == 1) ]] \
      || die "The repository must be an SSH address on GitHub, such as git@github.com:OWNER/REPO.git. Nothing was changed."
    # core.sshCommand is the folder's own: an SSH origin would be read with the deploy key too, which GitHub refuses
    case $(git remote get-url origin 2>/dev/null || true) in
      git@* | ssh://*) die "origin is an SSH address, and the deploy key would be used for it too. This script works with an https origin. Nothing was changed." ;;
    esac
    command -v ssh-keygen >/dev/null || die "ssh-keygen is missing (package openssh-client). Nothing was changed."
    mkdir -p "$KEYDIR" && chmod 700 "$KEYDIR"
    if [[ -f $KEY ]]; then ok "Deploy key: $KEY (already there)"
    else
      ssh-keygen -q -t ed25519 -N '' -C "omatalous-$INSTANCE@$(hostname -s 2>/dev/null || echo host)" -f "$KEY" >/dev/null
      ok "Deploy key made: $KEY"
    fi
    chmod 600 "$KEY"
    printf '%s\n' "$GITHUB_HOST_KEY" >"$KNOWN" && chmod 600 "$KNOWN"
    if git remote get-url private >/dev/null 2>&1; then git remote set-url private "$REPO"; else git remote add private "$REPO"; fi
    # the remote fetches only what lib/release.sh asks for, never into refs/tags (the public release tags)
    git config --unset-all remote.private.fetch >/dev/null 2>&1 || true
    git config remote.private.tagOpt --no-tags
    git config core.sshCommand "$(ssh_command)"
    ok "Remote private: $REPO (origin is unchanged)"
    say ""
    say "Add this key to the repository as a deploy key, read only (leave \"Allow write access\" off):"
    say ""
    say "  $(cat "$KEY.pub")"
    say ""
    page=$(keys_page "$REPO")
    [[ -z $page ]] || say "On GitHub: Settings > Deploy keys > Add deploy key, at $page"
    say "Each instance has a key of its own, and GitHub takes a key for one repository only."
    say "Then run: ${bold}./scripts/use-private.sh --check${reset}"
    ;;

  check)
    url=$(git remote get-url private 2>/dev/null) || die "This folder has no remote named private. Run ./scripts/use-private.sh --repo git@github.com:OWNER/REPO.git first."
    [[ $url == file://* || -f $KEY ]] || die "The deploy key $KEY is missing. Run ./scripts/use-private.sh --repo $url again."
    if on_private; then
      since=$(channel_get SINCE); was=$(private_follow || echo main)
    else since=$(git rev-parse HEAD); was=main; fi
    follow=${FOLLOW:-$was}
    [[ $follow == tags || ($follow =~ ^[A-Za-z0-9][A-Za-z0-9._/-]{0,99}$ && $follow != *..* && $follow != *.lock && $follow != */ && $follow != *//*) ]] || die "--follow takes a branch name or tags."
    heads=$(GIT_TERMINAL_PROMPT=0 timeout -k 5 60 git ls-remote private 2>&1) || {
      printf '%s\n' "$heads" | tail -3 >&2
      page=$(keys_page "$url")
      die "GitHub did not let this key read $url (above). Add the key as a read-only deploy key${page:+ at $page}, then run --check again. Public key: $KEY.pub. Nothing was changed."
    }
    if [[ $follow == tags ]]; then
      printf '%s\n' "$heads" | cut -f2 | grep -E '^refs/tags/v[0-9]+\.[0-9]+\.[0-9]+$' >/dev/null || die "The private repository has no release tag vX.Y.Z. Nothing was changed."
    else
      printf '%s\n' "$heads" | cut -f2 | grep -Fx "refs/heads/$follow" >/dev/null || die "The private repository has no branch $follow. Nothing was changed."
    fi
    ok "The deploy key reads $url"
    ! ours_ssh || git config core.sshCommand "$(ssh_command)"
    # the fetch of lib/release.sh, so update.sh and the helper see the same refs
    prev=$(channel_get CHANNEL); prev_follow=$(channel_get FOLLOW); prev_since=$(channel_get SINCE)
    write_channel private "$follow" "$since"
    if ! private_fetch || ! target=$(private_target); then
      if [[ -n $prev ]]; then write_channel "$prev" "$prev_follow" "$prev_since"; else rm -f ops/channel; fi
      die "The private repository could not be fetched (git fetch private). Nothing was changed."
    fi
    ok "Channel: private repository, $follow at $(git rev-parse --short "$target") (ops/channel)"
    if [[ $target == "$(git rev-parse HEAD)" ]]; then say "This folder is at that commit already."
    else say "Next: ${bold}./scripts/update.sh${reset} builds it on this machine, after the usual copy of the database."; fi
    ;;

  back)
    if ! on_private; then ok "This folder follows the public releases already. Nothing was changed."; exit 0; fi
    write_channel public '' "$(git rev-parse HEAD)"
    ! ours_ssh || git config --unset core.sshCommand
    git remote remove private >/dev/null 2>&1 || true
    git for-each-ref --format='%(refname)' refs/remotes/private/ | while IFS= read -r ref; do git update-ref -d "$ref"; done
    ok "Channel: public releases. The remote private is removed; the key stays in $KEYDIR."
    say "Next: ${bold}./scripts/update.sh${reset} goes to the newest public release (its image is verified as always)."
    say "Remove the deploy key on GitHub too if this instance will not switch again."
    ;;
esac
