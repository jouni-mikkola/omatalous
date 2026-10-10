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
import { loadConfig } from "../config.ts";
import { MigrationError } from "../db/migrate.ts";
import { dailyBackup, openDatabase, pruneBackupsByAge, takeSnapshot } from "../db/open.ts";
import { type BuildInfo, createServices } from "../services/context.ts";
import { logLookup } from "../services/industry.ts";
import { hourlyTick } from "../services/schedule.ts";
import { runUpgradeTasks } from "../services/upgrade.ts";
import { ensureSetupCode } from "../services/users.ts";
import { APP_VERSION } from "../version.ts";
import { loadOrCreateAppSecret } from "./app-secret.ts";
import { rotateAppSecret } from "./secret-rotate.ts";

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

const config = loadConfig(env, {
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

const dbPath = env.DB_PATH ?? join(dataDir, "banking.db");
let opened: Awaited<ReturnType<typeof openDatabase>>;
try {
  opened = await openDatabase(dbPath, env.MIGRATIONS_DIR || undefined);
} catch (err) {
  // a clear message instead of a stack trace; the container restarts and update.sh offers a rollback
  console.error(err instanceof MigrationError ? `Could not open the database. ${err.message}` : err);
  process.exit(1);
}
const { db, applied, snapshot } = opened;
// CLI output is read by scripts (ops poll prints one JSON object), so notices go to stderr there
const note = process.argv.length > 2 ? console.error : console.log;
if (snapshot) note(`database snapshot before migrating: ${snapshot}`);
if (applied.length) note(`migrations applied: ${applied.join(", ")}`);

// ── CLI mode ─────────────────────────────────────────────
if (process.argv.length > 2) {
  const cliServices = createServices({ db, config, build });
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
const app = createApp({ db, config, build, backupDir: join(dirname(dbPath), "backups"), backup: (day) => dailyBackup(db, dbPath, day), pruneBackups: (now) => void pruneBackupsByAge(dirname(dbPath), now) });
const s = app.services;

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
const scheduler = new Cron("15 * * * *", { protect: true }, async () => {
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
});

const port = Number(env.PORT ?? 8080);
const server = serve({ fetch: app.fetch, port, hostname: env.HOST ?? "0.0.0.0" }, async (info) => {
  const settings = await s.instance.load(true);
  console.log(`banking-app ${build.version} (${build.id}) listening on http://${info.address}:${info.port} (${settings.appBaseUrl})`);
  console.log(`database: ${dbPath} · sync hours: ${settings.syncHours.join(", ") || "-"} (${settings.timezone})`);
  if (settings.appBaseUrl.startsWith("http://") && !/localhost|127\.0\.0\.1/.test(settings.appBaseUrl)) {
    console.warn("address is plain http: use HTTPS (Caddy or Cloudflare Tunnel) for anything beyond this machine");
  }
  const code = await ensureSetupCode(s);
  if (code) {
    console.log(`\n  No users yet. Open ${settings.appBaseUrl} and create the admin with this setup code:\n\n      ${code}\n`);
    console.log("  (Get a new code with: docker compose exec banking node dist/node.js setup-code)\n");
  }
  // after a version change: re-derive merchant names and categories with the new rules
  runUpgradeTasks(s, build.id)
    .then((r) => r && console.log(`upgrade to ${build.version}: ${r.users} users, ${r.merchantsRenamed} merchant names and ${r.recategorised} categories updated`))
    .catch((err) => console.error("upgrade tasks failed:", err));
  // no register lookup here: the first hourly tick does it, so after an upgrade an admin
  // has time to see the new setting before any merchant name leaves the server
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    scheduler.stop();
    server.close(() => {
      db.close();
      process.exit(0);
    });
  });
}
