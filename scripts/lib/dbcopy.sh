# shellcheck shell=bash
# The code that copies the live database inside the container, shared by backup.sh, update.sh and ops-helper.sh.
# Run it with: docker compose exec -T banking node --disable-warning=ExperimentalWarning -e "$DBCOPY_JS" OPTIONS TARGET
# (docker compose run ... --entrypoint node banking ... works the same). TARGET is the last argument. OPTIONS is a
# comma separated list, or "-" for none: `exists` (do nothing when there is no database yet), `keep:REGEX`
# (afterwards keep only the 5 newest files of the target's folder whose name matches REGEX), `prune` (make no
# copy: TARGET is the folder, and only `keep:` is applied to it) and `room:N` (ask for N times the database free in
# place of twice: update.sh asks for 3, its own copy and the one the new version takes before a migration).
#
# The copy is made with VACUUM INTO, flushed to disk, then opened and checked (size, quick_check, this app's tables),
# and its folder is flushed too. A copy that fails is removed and the command exits with 1, so an empty file left by a
# full disk or a power cut never passes as a backup.
#
# Two rules are those of apps/server/src/db/backup-keep.ts, written out here because this code runs inside old and new
# images and cannot import it. A change to a rule there is a change here.
#   - A copy is not started unless its folder's disk has twice the database and its WAL free (assertRoomForCopy).
#   - `keep:` never deletes one of the three newest intact copies a restore would take (a plain .db name that is no
#     pre-restore- copy: restorableCopyName; newest by the time written: protectedCopies), and deletes nothing while
#     the live database fails quick_check (liveDatabaseProblem).
# shellcheck disable=SC2034 # used by the scripts that source this file
DBCOPY_JS=$(
  cat <<'JS'
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
// DBCOPY_DATA is for the tests; in the container the database is in /data
const live = (process.env.DBCOPY_DATA || "/data") + "/banking.db";
const target = process.argv[process.argv.length - 1];
const options = String(process.argv[1] || "").split(",");
const prune = options.includes("prune");
const dir = prune ? target : path.dirname(target);
// fsync on a read-only descriptor works on Linux, for a folder as well
const flush = (file) => {
  const fd = fs.openSync(file, "r");
  try {
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
};
const stop = (why) => {
  if (!prune) fs.rmSync(target, { force: true });
  console.error("database copy failed: " + why);
  process.exit(1);
};
const size = (file) => {
  try {
    return fs.statSync(file).size;
  } catch {
    return 0;
  }
};
const mb = (bytes) => (bytes / 1048576).toFixed(1) + " MB";
// Why FILE does not pass as a database with these tables, or null. Read-only, so a damaged file is not written to.
const fails = (file, tables) => {
  let db;
  try {
    db = new DatabaseSync(file, { readOnly: true });
    const q = db.prepare("PRAGMA quick_check(1)").all();
    if (q.length !== 1 || q[0].quick_check !== "ok") return "failed the integrity check";
    for (const t of tables) {
      if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(t)) return "has no table " + t;
    }
    return null;
  } catch (err) {
    return "cannot be read (" + err.message + ")";
  } finally {
    try {
      if (db) db.close();
    } catch {
      // nothing to release
    }
  }
};
const badCopy = (file) => (size(file) < 4096 ? "is empty or too small" : fails(file, ["_migrations", "users", "accounts", "transactions", "settings"]));
if (prune && !fs.existsSync(dir)) process.exit(0);
if (!prune) {
  if (!fs.existsSync(live)) {
    if (options.includes("exists")) process.exit(0);
    stop("there is no database");
  }
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  // assertRoomForCopy: a disk that cannot be measured does not stop a copy, and a refusal removes nothing
  const room = Number((options.find((o) => o.startsWith("room:")) || "room:2").slice(5)) || 2;
  const need = room * (size(live) + size(live + "-wal"));
  let free = need;
  try {
    const s = fs.statfsSync(dir);
    free = s.bavail * s.bsize;
  } catch {
    // VACUUM INTO fails on its own when the disk is full
  }
  if (free < need) {
    const times = room === 2 ? "twice" : room + " times";
    console.error("database copy failed: not enough free space in " + dir + ": " + mb(free) + " free, a copy needs " + mb(need) + " (" + times + " the database and its WAL)");
    process.exit(1);
  }
  fs.rmSync(target, { force: true });
  try {
    const db = new DatabaseSync(live);
    db.exec("VACUUM INTO '" + target.replace(/'/g, "''") + "'");
    db.close();
    flush(target);
  } catch (err) {
    stop(err.message);
  }
  const bad = badCopy(target);
  if (bad) stop("the copy " + bad);
}
const keep = options.find((o) => o.startsWith("keep:"));
if (keep) {
  const re = new RegExp(keep.slice(5));
  const old = fs.readdirSync(dir).filter((f) => re.test(f)).sort().reverse().slice(5);
  // liveDatabaseProblem: only a database that exists can be damaged, and while it is, every copy may be needed
  const damage = old.length && fs.existsSync(live) ? fails(live, []) : null;
  if (damage) console.error("database copies are not pruned: the live database " + damage);
  else if (old.length) {
    // protectedCopies, worked out before the first delete. A folder or a link is no copy.
    const written = (f) => {
      try {
        const st = fs.lstatSync(dir + "/" + f);
        return st.isFile() ? st.mtimeMs : null;
      } catch {
        return null;
      }
    };
    // restorableCopyName: a plain name, and never what a restore saved of the database it replaced
    const restorable = (f) => /^[A-Za-z0-9][A-Za-z0-9._-]{0,98}\.db$/.test(f) && !/^pre-restore-/.test(f);
    const newestFirst = fs
      .readdirSync(dir)
      .filter(restorable)
      .map((f) => ({ f, t: written(f) }))
      .filter((c) => c.t !== null)
      .sort((a, b) => b.t - a.t || (a.f < b.f ? 1 : -1));
    const safe = [];
    for (const { f } of newestFirst) {
      if (safe.length === 3) break;
      if (!badCopy(dir + "/" + f)) safe.push(f);
    }
    for (const f of old) if (!safe.includes(f)) fs.rmSync(dir + "/" + f, { force: true });
  }
}
// the new name has to survive a power cut too
try {
  flush(dir);
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
