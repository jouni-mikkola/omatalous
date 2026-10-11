/** Own sessions, security notices and (for admins) the event list. Asetukset > Turvallisuus. */
import { Hono } from "hono";
import { endSession } from "../auth/session.ts";
import type { AppEnv, Services } from "../services/context.ts";
import { UserError } from "../platform/errors.ts";
import { deviceLabel, dismissNotices, EVENT_KINDS, noticesFor, recordEvent, validKind } from "../services/security.ts";
import { clientIp } from "../auth/middleware.ts";
import { parseOptionalBoolean, strictObject } from "../platform/validate.ts";
import { body, queryInt } from "./shared.ts";

export function securityRoutes(s: Services) {
  const app = new Hono<AppEnv>();

  app.get("/sessions", async (c) => {
    const sessions = await s.users.listSessions(c.get("user").id, c.get("sessionId"));
    return c.json({ sessions: sessions.map(({ userAgent, ...rest }) => ({ ...rest, device: deviceLabel(userAgent) })) });
  });

  /** Ends all sessions. `keepCurrent` leaves this browser signed in. */
  app.post("/sessions/revoke-all", async (c) => {
    const user = c.get("user");
    const raw = strictObject(await body(c), ["keepCurrent"] as const);
    const keepCurrent = parseOptionalBoolean(raw.keepCurrent);
    await s.users.deleteSessionsOf(user.id, keepCurrent ? c.get("sessionId") : undefined);
    await recordEvent(s, { kind: "session_revoked", userId: user.id, ip: clientIp(c, s), userAgent: c.req.header("user-agent"), detail: keepCurrent ? "kaikki muut" : "kaikki" });
    if (!keepCurrent) await endSession(c, s, c.get("sessionId"));
    return c.json({ ok: true });
  });

  app.delete("/sessions/:id", async (c) => {
    const user = c.get("user");
    const id = c.req.param("id");
    if (!/^[A-Za-z0-9_-]{20}$/.test(id)) throw new UserError("Istuntoa ei löydy.");
    const current = (await s.users.listSessions(user.id, c.get("sessionId"))).find((x) => x.id === id)?.current ?? false;
    if (!(await s.users.deleteSessionByShortId(user.id, id))) throw new UserError("Istuntoa ei löydy.");
    await recordEvent(s, { kind: "session_revoked", userId: user.id, ip: clientIp(c, s), userAgent: c.req.header("user-agent"), detail: "yksi" });
    if (current) await endSession(c, s, c.get("sessionId"));
    return c.json({ ok: true });
  });

  app.get("/events", async (c) => {
    const user = c.get("user");
    const kind = c.req.query("kind");
    if (kind && !validKind(kind)) throw new UserError("Tuntematon tapahtumatyyppi.");
    const limit = Math.min(queryInt(c.req.query("limit")) ?? 100, 500);
    // members see their own events, admins everyone's
    const events = await s.security.list({ userId: user.role === "admin" ? undefined : user.id, kind, limit });
    return c.json({ events: events.map((e) => ({ id: e.id, at: e.at, kind: e.kind, username: e.username, ip: e.ip, device: e.userAgent ? deviceLabel(e.userAgent) : null, detail: e.detail })), kinds: EVENT_KINDS });
  });

  app.get("/notices", async (c) => c.json({ notices: await noticesFor(s, c.get("user")) }));

  app.post("/notices/seen", async (c) => {
    await dismissNotices(s, c.get("user"));
    return c.json({ ok: true });
  });

  return app;
}
