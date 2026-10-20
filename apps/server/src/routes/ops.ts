/** Maintenance requests for the host helper. Admin only (app.ts); see services/ops.ts. */
import { Readable } from "node:stream";
import { Hono } from "hono";
import type { AppEnv, Services } from "../services/context.ts";
import { strictObject } from "../platform/validate.ts";
import { requestRestore, restoreState } from "../services/db-restore.ts";
import { backupForDownload, cancelOp, opsAudit, opsState, requestOp } from "../services/ops.ts";
import { settleRemoteAccess } from "../services/remote-access.ts";
import { opsResetRoutes } from "./ops-reset.ts";
import { body, requestInfo } from "./shared.ts";

export function opsRoutes(s: Services) {
  const app = new Hono<AppEnv>();

  // JSON only: a form post (the classic CSRF shape) is refused before anything is read
  app.use("*", async (c, next) => {
    if (c.req.method !== "GET" && !/^application\/json\b/i.test(c.req.header("content-type") ?? "")) return c.json({ error: "Pyynnön pitää olla JSON." }, 415);
    await next();
  });
  app.route("/", opsResetRoutes(s));

  app.get("/state", async (c) => c.json(await opsState(s)));
  app.get("/audit", async (c) => c.json({ events: await opsAudit(s) }));

  app.post("/request", async (c) => c.json({ request: await requestOp(s, c.get("user"), await body(c), requestInfo(c, s)) }));

  app.post("/cancel/:id", async (c) => {
    await cancelOp(s, c.get("user"), c.req.param("id"), requestInfo(c, s));
    // a withdrawn remote access change leaves no request file behind
    await settleRemoteAccess(s);
    return c.json({ ok: true });
  });

  /** "Palauta viimeisin": the copy a restore would take now, and whether one is already asked for. */
  app.get("/restore-latest", (c) => c.json(restoreState(s)));

  /**
   * Replaces the household's database with that copy at the next start (services/db-restore.ts). The body is the
   * password and the word, never a file name: the server picks the copy. 202, and the server stops.
   */
  app.post("/restore-latest", async (c) => {
    const { password, confirm } = strictObject(await body(c), ["password", "confirm"] as const);
    return c.json(await requestRestore(s, c.get("user"), { password, confirm }, requestInfo(c, s)), 202);
  });

  /** POST, so the password is in the body and not in an address. */
  app.post("/backups/latest", async (c) => {
    const { password } = strictObject(await body(c), ["password"] as const);
    const file = await backupForDownload(s, c.get("user"), typeof password === "string" ? password : "", requestInfo(c, s));
    return c.body(Readable.toWeb(file.stream) as ReadableStream, 200, {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="${file.name}"`,
      "Content-Length": String(file.size),
      "Cache-Control": "no-store",
    });
  });

  return app;
}
