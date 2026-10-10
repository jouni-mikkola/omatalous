# shellcheck shell=bash
# The code that copies the live database inside the container, shared by backup.sh, update.sh and ops-helper.sh.
# Run it with: docker compose exec -T banking node --disable-warning=ExperimentalWarning -e "$DBCOPY_JS" OPTIONS TARGET
# (docker compose run ... --entrypoint node banking ... works the same). TARGET is the last argument. OPTIONS is a
# comma separated list, or "-" for none: `exists` (do nothing when there is no database yet) and `keep:REGEX`
# (afterwards keep only the 5 newest files of /data/backups whose name matches REGEX).
#
# The copy is made with VACUUM INTO, flushed to disk, then opened and checked (size, quick_check, this app's tables),
# and its folder is flushed too. A copy that fails is removed and the command exits with 1, so an empty file left by a
# full disk or a power cut never passes as a backup.
# shellcheck disable=SC2034 # used by the scripts that source this file
DBCOPY_JS=$(
  cat <<'JS'
const fs = require("node:fs");
const { DatabaseSync } = require("node:sqlite");
// DBCOPY_DATA is for the tests; in the container the database is in /data
const data = process.env.DBCOPY_DATA || "/data";
const target = process.argv[process.argv.length - 1];
const options = String(process.argv[1] || "").split(",");
// fsync on a read-only descriptor works on Linux, for a folder as well
const flush = (path) => {
  const fd = fs.openSync(path, "r");
  try {
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
};
const stop = (why) => {
  fs.rmSync(target, { force: true });
  console.error("database copy failed: " + why);
  process.exit(1);
};
if (!fs.existsSync(data + "/banking.db")) {
  if (options.includes("exists")) process.exit(0);
  stop("there is no database");
}
fs.mkdirSync(require("node:path").dirname(target), { recursive: true, mode: 0o700 });
fs.rmSync(target, { force: true });
try {
  const live = new DatabaseSync(data + "/banking.db");
  live.exec("VACUUM INTO '" + target.replace(/'/g, "''") + "'");
  live.close();
  flush(target);
} catch (err) {
  stop(err.message);
}
try {
  if (fs.statSync(target).size < 4096) stop("the copy is empty or too small");
  const copy = new DatabaseSync(target, { readOnly: true });
  const q = copy.prepare("PRAGMA quick_check(1)").all();
  if (q.length !== 1 || q[0].quick_check !== "ok") stop("the copy failed the integrity check");
  for (const t of ["_migrations", "users", "accounts", "transactions", "settings"]) {
    if (!copy.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(t)) stop("the copy has no table " + t);
  }
  copy.close();
} catch (err) {
  stop(err.message);
}
const keep = options.find((o) => o.startsWith("keep:"));
if (keep) {
  const re = new RegExp(keep.slice(5));
  const dir = require("node:path").dirname(target);
  const old = fs.readdirSync(dir).filter((f) => re.test(f)).sort().reverse().slice(5);
  for (const f of old) fs.rmSync(dir + "/" + f, { force: true });
}
// the new name has to survive a power cut too
try {
  flush(require("node:path").dirname(target));
} catch (err) {
  stop(err.message);
}
JS
)

# The check a rollback runs on the copy it may have to restore, before it stops anything:
#   docker compose run --rm --no-deps -T --entrypoint node banking --disable-warning=ExperimentalWarning -e "$DBCHECK_JS" FILE
# Exit 0 when FILE is a database that passes quick_check and has the migration history, else 1 with the reason on stderr.
# It opens the file read-only, so a missing file is reported and not created.
# shellcheck disable=SC2034 # used by update.sh
DBCHECK_JS=$(
  cat <<'JS'
const fs = require("node:fs");
const { DatabaseSync } = require("node:sqlite");
const bad = (why) => {
  console.error("database copy unusable: " + why);
  process.exit(1);
};
try {
  if (!fs.statSync(process.argv[1]).isFile()) bad("it is not a file");
  const db = new DatabaseSync(process.argv[1], { readOnly: true });
  const q = db.prepare("PRAGMA quick_check(1)").all();
  if (q.length !== 1 || q[0].quick_check !== "ok") bad("it failed quick_check");
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = '_migrations'").get()) bad("it has no migration history");
  db.close();
} catch (err) {
  bad(err.message);
}
JS
)

# fsync_path PATH: flushes one file or folder to disk, and fails when the flush fails. GNU and recent busybox sync take
# paths. An older sync ignores the operand and flushes everything, so no fallback is needed. A fallback to a plain sync
# on failure would hide a real I/O error behind a flush of something else.
fsync_path() { sync "$1"; }
# atomic_write FILE: stdin becomes FILE whole or not at all. It is written next to it, flushed, renamed over it, and the
# folder is flushed, so a power cut leaves the old content or the new, never an empty file. The mode comes from the umask.
atomic_write() {
  local target=$1 tmp=$1.new
  cat >"$tmp" && fsync_path "$tmp" && mv -f "$tmp" "$target" && fsync_path "$(dirname "$target")" || { rm -f "$tmp"; return 1; }
}
