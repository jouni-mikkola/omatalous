/**
 * Linux / Docker entry point: HTTP server + static web UI + sync scheduler,
 * SQLite in DATA_DIR. With arguments (`node dist/node.js user …`) it runs
 * the user-management CLI instead of the server.
 */
import "@banking/core/english";
import "@banking/core/late";
import { createHash } from "node:crypto";
import type { AddressInfo } from "node:net";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { Cron } from "croner";
import { createApp } from "../app.ts";
import { runCli } from "../cli.ts";
import { listenPort, loadConfig } from "../platform/config.ts";
import { SECRET_ROTATE_LABEL } from "../db/backup-keep.ts";
import { MigrationError } from "../db/migrate.ts";
import { runMigrateCheck } from "../db/migrate-check.ts";
import { optimizeDatabase } from "../db/pragmas.ts";
import { openDatabase, takeSnapshot } from "../db/open.ts";
import { DAMAGED_PAGE, damagedLine, damageOf } from "../db/startup-gate.ts";
import { type BuildInfo, createServices } from "../services/context.ts";
import { track, waitForInflight } from "../platform/inflight.ts";
import { logLookup } from "../services/industry.ts";
import { finishPendingReprocess, recoverAfterCrash } from "../services/recovery.ts";
import { staticFiles } from "../static-files.ts";
import { findSignersFile } from "../modules/bundle.ts";
import { loadInstalledModule, type ModuleRuntime, openWithModule, type StartState } from "../modules/load.ts";
import { moduleBase } from "../routes/module-files.ts";
import { recheckModule } from "../services/modules.ts";
import { hourlyTick } from "../services/schedule.ts";
import { recordEvent } from "../services/security.ts";
import { upgradeAndLog } from "../services/upgrade.ts";
import { ensureSetupCode } from "../services/users.ts";
import { APP_VERSION } from "../version.ts";
import { loadOrCreateAppSecret } from "./app-secret.ts";
import { finishInterruptedRotation, rotateAppSecret, secretFileDiffers } from "./secret-rotate.ts";
import { applyServerTimeouts } from "./server-timeouts.ts";
import { SHUTDOWN_WAIT_MS, STOP_FAULTS, STOP_SIGNALS, stopHandler } from "./shutdown.ts";

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

// `migrate-check` works on a copy of the file it is given: it runs before the app secret or the live database is touched
if (process.argv[2] === "migrate-check") process.exit(await runMigrateCheck(process.argv.slice(3), undefined, { migrationsDir: env.MIGRATIONS_DIR || undefined }));

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
  } else if (r.created) console.log(`Created the app secret ${secretPath} (mode 600). Keep a copy elsewhere.`);
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

// the add-on module, before the database opens so its migrations run with the shared ones (docs/MODULES.md)
const moduleRoot = join(dataDir, "modules");
const signersFile = findSignersFile();
const moduleStart = await loadInstalledModule({ root: moduleRoot, signersFile, appVersion: APP_VERSION }).catch((err: Error): StartState => {
  console.error(`add-on module did not load: ${err.name}`);
  return { state: "none" };
});
// A CLI call's stdout is the command's answer and nothing else: the maintenance helper reads `ops poll` as one exact
// line (scripts/ops-helper.sh, poll_once). So the module's line goes to stderr there, and to the log of the server.
const moduleLine = process.argv.length > 2 ? console.error : console.log;
if (moduleStart.state === "connected") moduleLine(`add-on module ${moduleStart.id} ${moduleStart.version} loaded`);
else if (moduleStart.state === "waiting") moduleLine(`add-on module ${moduleStart.id} ${moduleStart.version} is not for this version; running without it`);
else if (moduleStart.state === "refused") moduleLine(`add-on module ${moduleStart.id} ${moduleStart.version} refused: ${moduleStart.reason}; running without it`);
const modules: ModuleRuntime = { root: moduleRoot, signersFile, start: moduleStart };

// server mode only. A damaged database is not started on and not touched: the server answers every request with the
// notice and waits. It does not exit, as the container would restart it and the host helper would read the loop as a bad update.
if (process.argv.length <= 2) {
  const lines: string[] = [];
  const damage = damageOf(dbPath, lines);
  for (const line of lines) console.error(line);
  if (damage !== null) {
    console.error(damagedLine(dbPath, damage));
    serve({ fetch: () => new Response(DAMAGED_PAGE, { status: 503, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } }), port: listenPort(env), hostname: env.HOST ?? "0.0.0.0" });
    await new Promise<never>(() => undefined);
  }
}

let opened: Awaited<ReturnType<typeof openDatabase>>;
/** The error of the module's migration that left it out at this start, for the security log. */
let moduleDropped: string | null = null;
try {
  const withModule = await openWithModule(moduleStart, () => openDatabase(dbPath, env.MIGRATIONS_DIR || undefined));
  opened = withModule.opened;
  moduleDropped = withModule.dropped;
  modules.start = withModule.start;
  if (withModule.start.state === "refused") console.error(`add-on module ${withModule.start.id} ${withModule.start.version} left out: ${moduleDropped}; running without it`);
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
  // the data folder too: `ops poll` clears the helper's wake file in it (services/ops-wake.ts)
  const cliServices = createServices({ db, config, build, backupDir: join(dirname(dbPath), "backups"), modules });
  const code = await runCli(cliServices, process.argv.slice(2), {
    secretFile,
    readStdin: async () => {
      const chunks: Buffer[] = [];
      for await (const c of process.stdin) chunks.push(c as Buffer);
      return Buffer.concat(chunks).toString("utf8");
    },
    rotateSecret: secretFile ? () => rotateAppSecret(cliServices, { secretFile: secretFile!, snapshot: () => takeSnapshot(db, dbPath, SECRET_ROTATE_LABEL, new Date()) }) : undefined,
  }).catch((err: Error) => {
    console.error(err.message);
    return 1;
  });
  db.close();
  process.exit(code);
}

// ── server mode ──────────────────────────────────────────
const app = createApp({ db, config, build, modules, secretStale: () => secretFileDiffers(secretFile, config.appSecret), backupDir: join(dirname(dbPath), "backups") });
const s = app.services;

if (moduleDropped && modules.start.state === "refused") {
  const { id, version } = modules.start;
  await recordEvent(s, { kind: "module_refused", userId: null, detail: `${id} ${version}: a migration failed at start` }).catch((err) => console.error("recording the module's failed migration failed:", err));
}

const staticDir = env.STATIC_DIR ?? [resolve(here, "../public"), resolve(here, "../../web/dist")].find((p) => existsSync(p));
if (staticDir) {
  staticFiles(app, staticDir, modules.start.state === "connected" ? `<meta name="omatalous-module" content="${moduleBase(modules.start.id, modules.start.version)}">` : undefined);
} else {
  console.warn("web UI build not found (pnpm build), serving the API only");
}

// Ticks every hour; the sync hours and time zone are read from the settings each
// time, so changes made in the browser apply without a restart.
const scheduler = new Cron("15 * * * *", { protect: true }, () => track(tick()));
async function tick(): Promise<void> {
  try {
    const { synced, lookup } = await hourlyTick(s);
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
// a new app version, a module waiting for one, or a day gone: look for the module that fits (services/modules.ts)
void track(recheckModule(s).catch((err: Error) => console.error(`add-on module check failed: ${err.name}`)));

const port = listenPort(env);
// serve takes a callback that returns nothing, so the async work runs here and a failure is logged, not left unhandled
const announce = async (info: AddressInfo) => {
  const settings = await s.instance.load(true);
  console.log(`banking-app ${build.version} (${build.id}) listening on http://${info.address}:${info.port} (${settings.appBaseUrl})`);
  console.log(`database: ${dbPath} · sync hours: ${settings.syncHours.join(", ") || "-"} (${settings.timezone})`);
  if (settings.appBaseUrl.startsWith("http://") && !/localhost|127\.0\.0\.1/.test(settings.appBaseUrl)) {
    console.warn("address is plain http: use HTTPS (Caddy) for anything beyond this machine");
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
};
const server = serve({ fetch: app.fetch, port, hostname: env.HOST ?? "0.0.0.0" }, (info) => {
  announce(info).catch((err) => console.error("startup notice failed:", err));
});
applyServerTimeouts(server);

const stop = stopHandler({
  stopScheduler: () => scheduler.stop(),
  closeServer: (done) => void server.close(done),
  closeConnections: () => (server as unknown as { closeAllConnections?: () => void }).closeAllConnections?.(),
  waitForInflight,
  closeDb: () => db.close(),
  exit: (code) => process.exit(code),
  timeoutMs: SHUTDOWN_WAIT_MS,
  log: (m) => console.log(m),
});
for (const signal of STOP_SIGNALS) process.on(signal, () => stop(signal));
for (const fault of STOP_FAULTS) process.on(fault, (err: unknown) => stop(fault, err));
