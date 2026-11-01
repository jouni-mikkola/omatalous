#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# Omatalous copy to another machine (Asetukset > Palvelin > Varmuuskopio toiselle koneelle).
#
# Run by the ops helper (scripts/lib/ops-offsite.sh) with the target in the environment, never by hand:
#   OFFSITE_HOST, OFFSITE_PORT, OFFSITE_USER, OFFSITE_DIR   where the copy goes (sftp)
#   OFFSITE_RECIPIENT                                       the age public key the copy is encrypted to
#   OFFSITE_KEY                                             the file of the ssh key to sign in with
#   OFFSITE_KNOWN_HOSTS                                     the file that remembers the other machine's host key
#
# Takes a new copy with scripts/backup.sh into a private folder, encrypted with age to the public key (so the database and
# the app secret leave this machine only as noise), uploads the two files under a hidden name, renames them when the
# size on the other side matches, and keeps the newest 30 copies there. Nothing but the encrypted files is sent. The
# secret half of the age key is not on this machine at all: it is what opens a copy (docs/ADVANCED.md#backup-to-another-machine).
#
# The host key of the other machine is trusted on first use and remembered in OFFSITE_KNOWN_HOSTS; a key that changes
# later stops the run (exit 14).
# Exit codes: 10 age missing, 11 sftp missing, 12 could not connect or upload, 13 size on the other side differs,
# 14 the host key changed, 1 anything else.
# ──────────────────────────────────────────────────────────────────────────────
set -euo pipefail
cd "$(dirname "$0")/.."
umask 077

KEEP=30
: "${OFFSITE_HOST:?}" "${OFFSITE_PORT:?}" "${OFFSITE_USER:?}" "${OFFSITE_DIR:?}" "${OFFSITE_RECIPIENT:?}" "${OFFSITE_KEY:?}" "${OFFSITE_KNOWN_HOSTS:?}"
die() { printf '%s offsite failed: %s\n' "$(date '+%F %T')" "$1" >&2; exit "${2:-1}"; }

command -v age >/dev/null || die "age is missing (sudo apt install age)." 10
command -v sftp >/dev/null || die "sftp is missing (sudo apt install openssh-client)." 11

find backups -maxdepth 1 -type d -name '.offsite.*' -mmin +120 -exec rm -rf -- {} + 2>/dev/null || true
STAGE=$(mktemp -d "${PWD}/backups/.offsite.XXXXXX" 2>/dev/null || { mkdir -p backups && mktemp -d "${PWD}/backups/.offsite.XXXXXX"; })
LISTING=$STAGE/listing
trap 'rm -rf -- "$STAGE"' EXIT

# the same sftp session for every call; BatchMode means it never asks for a password
sftp_run() { # sftp_run: commands on stdin
  sftp -F /dev/null -b - -P "$OFFSITE_PORT" -i "$OFFSITE_KEY" -o BatchMode=yes -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new \
    -o UserKnownHostsFile="$OFFSITE_KNOWN_HOSTS" -o ConnectTimeout=20 -o ServerAliveInterval=15 -o ServerAliveCountMax=4 \
    "$OFFSITE_USER@$OFFSITE_HOST" 2>&1
}
sftp_check() { # sftp_check: run, and turn a changed host key into exit 14
  local out rc=0
  out=$(cd "$STAGE" && sftp_run) || rc=$?
  printf '%s\n' "$out" | grep -v '^sftp>' >&2 || true
  if grep -q 'REMOTE HOST IDENTIFICATION HAS CHANGED\|Host key verification failed' <<<"$out"; then die "the host key of $OFFSITE_HOST changed. Nothing was sent." 14; fi
  printf '%s\n' "$out" >"$LISTING"
  return "$rc"
}

BACKUP_DIR=$STAGE BACKUP_AGE_RECIPIENT=$OFFSITE_RECIPIENT BACKUP_NO_COPY=1 ./scripts/backup.sh
db=$(find "$STAGE" -maxdepth 1 -name 'talous-*.db.gz.age' -print -quit)
sec=$(find "$STAGE" -maxdepth 1 -name 'talous-*.app_secret.age' -print -quit)
[[ -s $db && -s $sec ]] || die "backup.sh did not make both encrypted files."
files=("$db" "$sec")

# the folder: made if its parent exists (an existing folder makes the command fail, which is fine), then the uploads.
# The batch is a file and sftp runs in the shell itself, so a changed host key ends the run here (exit 14). The files are
# put by their bare names from the stage folder: nothing of this machine's paths is in the batch.
{
  printf -- '-mkdir %s\n' "$OFFSITE_DIR"
  printf 'cd %s\n' "$OFFSITE_DIR"
  for f in "${files[@]}"; do printf 'put %s .%s.part\n' "${f##*/}" "${f##*/}"; done
  for f in "${files[@]}"; do printf -- '-rm %s\nrename .%s.part %s\n' "${f##*/}" "${f##*/}" "${f##*/}"; done
  printf 'ls -l\n'
} >"$STAGE/batch"
sftp_check <"$STAGE/batch" || die "could not upload to $OFFSITE_USER@$OFFSITE_HOST:$OFFSITE_DIR (see the lines above)." 12

for f in "${files[@]}"; do
  name=${f##*/}
  want=$(stat -c %s "$f")
  got=$(awk -v n="$name" '$NF == n && $5 ~ /^[0-9]+$/ { print $5 }' "$LISTING" | tail -1)
  [[ $got == "$want" ]] || die "$name is ${got:-missing} bytes on the other machine, expected $want." 13
done
echo "$(date '+%F %T') offsite: ${db##*/} and ${sec##*/} uploaded to $OFFSITE_HOST"

# keep the newest $KEEP copies on the other machine: the names carry the stamp, so a sort is an age order. This run's
# own copy is never removed, and nothing is pruned when it is not among the newest (a wrong clock here, or a folder that
# already holds later copies).
mine=${db##*/}; mine=${mine#talous-}; mine=${mine%.db.gz.age}
mapfile -t stamps < <(awk '{ n = $NF } n ~ /^talous-[0-9]{8}-[0-9]{6}\.db\.gz\.age$/ { sub(/^talous-/, "", n); sub(/\.db\.gz\.age$/, "", n); print n }' "$LISTING" | sort -u)
if ((${#stamps[@]} > KEEP)); then
  old=("${stamps[@]:0:${#stamps[@]}-KEEP}")
  if printf '%s\n' "${old[@]}" | grep -xF "$mine" >/dev/null; then
    echo "offsite: this copy is not among the newest $KEEP on the other machine (is the clock right?), so no old copy was removed" >&2
  else
    for s in "${old[@]}"; do
      printf -- '-rm %s/talous-%s.db.gz.age\n-rm %s/talous-%s.app_secret.age\n' "$OFFSITE_DIR" "$s" "$OFFSITE_DIR" "$s"
    done >"$STAGE/prune"
    if sftp_check <"$STAGE/prune"; then echo "$(date '+%F %T') offsite: ${#old[@]} old copy/copies removed on the other machine"
    else echo "offsite: could not remove old copies on the other machine" >&2; fi
  fi
fi
