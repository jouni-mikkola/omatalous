/**
 * Linux / Docker entry point: HTTP server + static web UI + sync scheduler,
 * SQLite in DATA_DIR. With arguments (`node dist/node.js user …`) it runs
 * the user-management CLI instead of the server.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Cron } from "croner";
import { createApp } from "../app.ts";
import { runCli } from "../cli.ts";
import { runCloudflareCli } from "../cli-cloudflare.ts";
import { loadConfig } from "../platform/config.ts";
import { MigrationError } from "../db/migrate.ts";
import { runMigrateCheck } from "../db/migrate-check.ts";
import { optimizeDatabase } from "../db/pragmas.ts";
import { dailyBackup, openDatabase, pruneBackupsByAge, takeSnapshot } from "../db/open.ts";
import { RestoreError, restoreDatabase } from "../db/restore.ts";
import { gateDatabase, gateEvent, isNews, notDoneNotice, requestOutcome } from "../db/startup-gate.ts";
import { type BuildInfo, createServices } from "../services/context.ts";
import { track, waitForInflight } from "../platform/inflight.ts";
import { logLookup } from "../services/industry.ts";
import { finishPendingReprocess, recoverAfterCrash } from "../services/recovery.ts";
import { hourlyTick } from "../services/schedule.ts";
import { fiTime, recordEvent } from "../services/security.ts";
import { upgradeAndLog } from "../services/upgrade.ts";
import { ensureSetupCode } from "../services/users.ts";
import { APP_VERSION } from "../version.ts";
import { loadOrCreateAppSecret } from "./app-secret.ts";
import { finishInterruptedRotation, rotateAppSecret, secretFileDiffers } from "./secret-rotate.ts";
import { SHUTDOWN_WAIT_MS, shutdown } from "./shutdown.ts";

const here = dirname(fileURLToPath(import.meta.url));
const env = process.env;

/** Secrets come from files (Docker / install.sh) so they never appear in `docker inspect` or process listings. */
function readSecret(path: string | undefined, name: string): string | undefined {
  if (!path) return undefined;
  if (!existsSync(path)) {
    console.warn(`${name}: file ${path} not found`);
    return undefined;
  }
  return readFileSync(path, "utf8").trim();
}

const dataDir = env.DATA_DIR ?? "./data";
const dbPath = env.DB_PATH ?? join(dataDir, "banking.db");

// `restore` runs before anything opens the database: it has to work on an empty or damaged one too
if (process.argv[2] === "restore") {
  const file = process.argv[3];
  if (!file) {
    console.error("Usage: node dist/node.js restore <file in the data folder>");
    process.exit(1);
  }
  try {
    for (const line of restoreDatabase(dbPath, file, new Date())) console.log(line);
    process.exit(0);
  } catch (err) {
    console.error(err instanceof RestoreError ? `Restore refused. ${err.message}` : `Restore failed: ${(err as Error).message}`);
    process.exit(1);
  }
}

// `migrate-check` works on a copy of the file it is given: it runs before the app secret or the live database is touched
if (process.argv[2] === "migrate-check") process.exit(await runMigrateCheck(process.argv.slice(3), undefined, { migrationsDir: env.MIGRATIONS_DIR || undefined }));

// `cloudflare up|down` talks only to Cloudflare, so it needs no database and no app secret (the installer runs it with `docker run --rm`)
if (process.argv[2] === "cloudflare") {
  const code = await runCloudflareCli(process.argv.slice(3), env);
  // the installer reads both streams; a pipe or socket can take a write in parts and process.exit would drop the rest
  await Promise.all([process.stdout, process.stderr].map((out) => new Promise<void>((done) => out.write("", () => done()))));
  process.exit(code);
}

// The app secret is created on first start (Docker: /secrets/app_secret in its own volume).
let appSecret: string | undefined;
let secretFile: string | null = null;
if (!env.APP_SECRET) {
  const secretPath = env.APP_SECRET_FILE ?? resolve(dataDir, "..", "secrets", "app_secret");
  secretFile = secretPath;
  const r = loadOrCreateAppSecret(secretPath);
  if (r.secret === null) {
    // fail loudly: a running app that cannot seal bank keys hides the fault, a crash shows up in logs and doctor.sh
    console.error(`APP_SECRET: ${r.problem}. Fix the file or its path (APP_SECRET_FILE) and restart.`);
    process.exit(1);
  } else if (r.created) console.log(`Created the app secret ${secretPath} (mode 600). Keep a copy elsewhere, see docs/ADVANCED.md#backups.`);
  appSecret = r.secret;
}

let config = loadConfig(env, {
  // optional: a shared bank key from a file instead of the browser (advanced)
  privateKeyPem: readSecret(env.EB_PRIVATE_KEY_FILE, "EB_PRIVATE_KEY_FILE"),
  appSecret,
});
/** The bundle's own hash: any code change (a new image) gives a new id. From src/ (tsx) every start counts as new. */
function buildInfo(): BuildInfo {
  const file = fileURLToPath(import.meta.url);
  if (file.endsWith(".ts")) return { version: APP_VERSION, id: `${APP_VERSION}+dev-${Date.now()}` };
  return { version: APP_VERSION, id: `${APP_VERSION}+${createHash("sha256").update(readFileSync(file)).digest("hex").slice(0, 16)}` };
}
const build = buildInfo();

// server mode only: the gate may move a damaged database aside and restore a copy, which a CLI call must never do
const gate = process.argv.length > 2 ? null : gateDatabase(dbPath, new Date(), env.MIGRATIONS_DIR || undefined);
for (const line of gate?.lines ?? []) console.error(line);

let opened: Awaited<ReturnType<typeof openDatabase>>;
try {
  opened = await openDatabase(dbPath, env.MIGRATIONS_DIR || undefined);
} catch (err) {
  // a clear message instead of a stack trace; the container restarts and update.sh offers a rollback
  console.error(err instanceof MigrationError ? `Could not open the database. ${err.message}` : err);
  process.exit(1);
}
const { db, applied, snapshot } = opened;
if (secretFile) {
  // a rotation that stopped after its database commit: finish the rename before anything uses the secret
  const rotated = await finishInterruptedRotation(createServices({ db, config, build }), secretFile).catch((err) => {
    console.error("checking for an interrupted secret rotation failed:", err);
    return null;
  });
  if (rotated) config = loadConfig(env, { privateKeyPem: readSecret(env.EB_PRIVATE_KEY_FILE, "EB_PRIVATE_KEY_FILE"), appSecret: rotated });
}
// CLI output is read by scripts (ops poll prints one JSON object), so notices go to stderr there
const note = process.argv.length > 2 ? console.error : console.log;
if (snapshot) note(`database snapshot before migrating: ${snapshot}`);
if (applied.length) note(`migrations applied: ${applied.join(", ")}`);

// ── CLI mode ─────────────────────────────────────────────
if (process.argv.length > 2) {
  // the data folder too: `ops access` reads the prepared change of remote access from it (services/access-request.ts)
  const cliServices = createServices({ db, config, build, backupDir: join(dirname(dbPath), "backups") });
  const code = await runCli(cliServices, process.argv.slice(2), {
    secretFile,
    readStdin: async () => {
      const chunks: Buffer[] = [];
      for await (const c of process.stdin) chunks.push(c as Buffer);
      return Buffer.concat(chunks).toString("utf8");
    },
    rotateSecret: secretFile ? () => rotateAppSecret(cliServices, { secretFile: secretFile!, snapshot: () => takeSnapshot(db, dbPath, "pre-secret-rotate", new Date()) }) : undefined,
  }).catch((err: Error) => {
    console.error(err.message);
    return 1;
  });
  db.close();
  process.exit(code);
}

// ── server mode ──────────────────────────────────────────
const app = createApp({ db, config, build, secretStale: () => secretFileDiffers(secretFile, config.appSecret), backupDir: join(dirname(dbPath), "backups"), backup: (day) => dailyBackup(db, dbPath, day), pruneBackups: (now) => void pruneBackupsByAge(dirname(dbPath), now, dbPath) });
const s = app.services;

/** What the gate did at this start: an event in the security log and a notice for every admin. */
async function reportGate(): Promise<void> {
  if (!gate || (gate.state === "ok" && !gate.notDone)) return;
  const users = await s.users.list();
  const admins = users.filter((u) => u.role === "admin");
  // who asked for a restore in the browser, when this database (after a restore, the copy) still has them
  const known = (id: string | null | undefined) => users.find((u) => u.id === id);
  const outcome = requestOutcome(gate);
  if (outcome) await recordEvent(s, { kind: "ops_result", userId: known(outcome.by)?.id ?? null, detail: outcome.detail });
  if (gate.notDone) {
    // a request that was not done is never silent: the data the admin wanted gone is still there
    const detail = notDoneNotice(gate.notDone, known(gate.notDone.by)?.displayName ?? null);
    for (const u of admins) await recordEvent(s, { kind: "ops_notice", userId: u.id, detail, notify: true });
  }
  if (gate.state === "ok") return;
  const { timezone } = await s.instance.load();
  const event = gateEvent(gate, (iso) => fiTime(iso, timezone), gate.state === "restored" ? known(gate.by)?.displayName : null);
  for (const u of admins) {
    // a database that stays damaged: one unread notice for the admin, not one more at every start
    if (isNews(event, await s.security.unseenNotices(u.id))) await recordEvent(s, { ...event, userId: u.id, notify: true });
  }
}
// a damaged database may refuse the read or the write: the start goes on
await reportGate().catch((err) => console.error("recording what the database check did failed:", err));

const staticDir = env.STATIC_DIR ?? [resolve(here, "../public"), resolve(here, "../../web/dist")].find((p) => existsSync(p));
if (staticDir) {
  // Vite's /assets/* names contain a content hash: cache forever. The page itself must be
  // revalidated, so a browser picks up a new version right after an upgrade.
  app.use("/*", async (c, next) => {
    await next();
    if (c.req.path.startsWith("/api/") || !c.res.ok) return;
    c.header("Cache-Control", c.req.path.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-cache");
  });
  app.use("/*", serveStatic({ root: staticDir }));
  app.get("*", serveStatic({ root: staticDir, path: "index.html" }));
} else {
  console.warn("web UI build not found (pnpm build), serving the API only");
}

// Ticks every hour; the sync hours and time zone are read from the settings each
// time, so changes made in the browser apply without a restart.
const scheduler = new Cron("15 * * * *", { protect: true }, () => track(tick()));
async function tick(): Promise<void> {
  try {
    const { synced, lookup, backup } = await hourlyTick(s);
    if (backup) console.log(`backup: ${basename(backup)}`);
    for (const [userId, r] of Object.entries(synced ?? {})) {
      console.log(`scheduled sync ${userId.slice(0, 8)}: ${r.status}, ${r.inserted} new`, r.messages.join(" | "));
    }
    logLookup(lookup);
  } catch (err) {
    console.error("hourly tick failed:", err);
  }
}

// a process that was killed left locks, "running" fetches and unprocessed imports behind: repair them
// before the first request, so a manual fetch is not refused for 15 minutes
(await import("../services/disk.ts")).startReserve(s); // the 64 MB a full disk gives back; imported here to keep this to one line
await recoverAfterCrash(s, new Date()).catch((err) => console.error("recovery at start failed:", err));
await optimizeDatabase(s.db);

const port = Number(env.PORT ?? 8080);
const server = serve({ fetch: app.fetch, port, hostname: env.HOST ?? "0.0.0.0" }, async (info) => {
  const settings = await s.instance.load(true);
  console.log(`banking-app ${build.version} (${build.id}) listening on http://${info.address}:${info.port} (${settings.appBaseUrl})`);
  console.log(`database: ${dbPath} · sync hours: ${settings.syncHours.join(", ") || "-"} (${settings.timezone})`);
  if (settings.appBaseUrl.startsWith("http://") && !/localhost|127\.0\.0\.1/.test(settings.appBaseUrl)) {
    console.warn("address is plain http: use HTTPS (Caddy or Cloudflare Tunnel) for anything beyond this machine");
  }
  const code = await ensureSetupCode(s, { renewExpired: true });
  if (code) {
    console.log(`\n  No users yet. Open ${settings.appBaseUrl} and create the admin with this setup code:\n\n      ${code}\n`);
    console.log("  (Get a new code with: docker compose exec banking node dist/node.js setup-code)\n");
  }
  // after a version change: re-derive merchant names and categories with the new rules
  track(
    upgradeAndLog(s)
      .then(() => finishPendingReprocess(s))
      .catch((err) => console.error("finishing leftover work failed:", err)),
  );
  // no register lookup here: the first hourly tick does it, so after an upgrade an admin
  // has time to see the new setting before any merchant name leaves the server
});

let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    if (stopping) return;
    stopping = true;
    console.log(`${signal}: stopping, running work gets ${SHUTDOWN_WAIT_MS / 1000} s`);
    void shutdown({
      stopScheduler: () => scheduler.stop(),
      closeServer: (done) => void server.close(done),
      closeConnections: () => (server as unknown as { closeAllConnections?: () => void }).closeAllConnections?.(),
      waitForInflight,
      closeDb: () => db.close(),
      exit: (code) => process.exit(code),
      timeoutMs: SHUTDOWN_WAIT_MS,
      log: (m) => console.log(m),
    });
  });
}
