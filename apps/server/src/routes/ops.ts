/** Maintenance requests for the host helper. Admin only (app.ts); see services/ops.ts. */
import { Readable } from "node:stream";
import { Hono } from "hono";
import { clientIp } from "../auth/middleware.ts";
import type { AppEnv, Services } from "../services/context.ts";
import { strictObject } from "../platform/validate.ts";
import { backupForDownload, cancelOp, opsAudit, opsState, requestOp } from "../services/ops.ts";
import { settleRemoteAccess } from "../services/remote-access.ts";
import { body } from "./shared.ts";

export function opsRoutes(s: Services) {
  const app = new Hono<AppEnv>();

  // JSON only: a form post (the classic CSRF shape) is refused before anything is read
  app.use("*", async (c, next) => {
    if (c.req.method !== "GET" && !/^application\/json\b/i.test(c.req.header("content-type") ?? "")) return c.json({ error: "Pyynnön pitää olla JSON." }, 415);
    await next();
  });

  const req = (c: Parameters<typeof clientIp>[0]) => ({ ip: clientIp(c, s), userAgent: c.req.header("user-agent") });

  app.get("/state", async (c) => c.json(await opsState(s)));
  app.get("/audit", async (c) => c.json({ events: await opsAudit(s) }));

  app.post("/request", async (c) => c.json({ request: await requestOp(s, c.get("user"), await body(c), req(c)) }));

  app.post("/cancel/:id", async (c) => {
    await cancelOp(s, c.get("user"), c.req.param("id"), req(c));
    // a withdrawn remote access change leaves no request file behind
    await settleRemoteAccess(s);
    return c.json({ ok: true });
  });

  /** POST, so the password is in the body and not in an address. */
  app.post("/backups/latest", async (c) => {
    const { password } = strictObject(await body(c), ["password"] as const);
    const file = await backupForDownload(s, c.get("user"), typeof password === "string" ? password : "", req(c));
    return c.body(Readable.toWeb(file.stream) as ReadableStream, 200, {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="${file.name}"`,
      "Content-Length": String(file.size),
      "Cache-Control": "no-store",
    });
  });

  return app;
}
