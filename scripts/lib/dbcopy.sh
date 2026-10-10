# shellcheck shell=bash
# The code that copies the live database inside the container, shared by backup.sh, update.sh and ops-helper.sh.
# Run it with: docker compose exec -T banking node --disable-warning=ExperimentalWarning -e "$DBCOPY_JS" OPTIONS TARGET
# (docker compose run ... --entrypoint node banking ... works the same). TARGET is the last argument. OPTIONS is a
# comma separated list, or "-" for none: `exists` (do nothing when there is no database yet) and `keep:REGEX`
# (afterwards keep only the 5 newest files of /data/backups whose name matches REGEX).
#
# The copy is made with VACUUM INTO, then opened and checked (size, quick_check, this app's tables). A copy that
# fails is removed and the command exits with 1, so an empty file left by a full disk never passes as a backup.
# shellcheck disable=SC2034 # used by the scripts that source this file
DBCOPY_JS=$(
  cat <<'JS'
const fs = require("node:fs");
const { DatabaseSync } = require("node:sqlite");
// DBCOPY_DATA is for the tests; in the container the database is in /data
const data = process.env.DBCOPY_DATA || "/data";
const target = process.argv[process.argv.length - 1];
const options = String(process.argv[1] || "").split(",");
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
JS
)
