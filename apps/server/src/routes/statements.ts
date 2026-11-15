/**
 * Card statement rows: the rows of ONE bill, written whole and taken away whole. Own bills only (the bill must be a row of the
 * signed-in member's account). The rules are in `services/statements.ts`; a refusal there carries a `code` the page tells apart.
 */
import { Hono } from "hono";
import { NotFound } from "../platform/errors.ts";
import type { AppEnv, Services } from "../services/context.ts";
import { parseStatement, removeStatement, saveStatement, StatementRefusal, statementsView, syncStatementState } from "../services/statements.ts";
import { body } from "./shared.ts";

/** Writes of a member in this long a time, and how many: a page writes one bill at a time, so a script is what reaches this. */
const WINDOW_MS = 60_000;
const MAX_WRITES = 30;

export function statementRoutes(s: Services) {
  const app = new Hono<AppEnv>();
  const writes = new Map<string, number[]>();

  /** Counts one write of the user; the number of seconds to wait when the user is over the limit, else 0. */
  const limited = (userId: string): number => {
    const now = s.now().getTime();
    const recent = (writes.get(userId) ?? []).filter((at) => now - at < WINDOW_MS);
    if (recent.length >= MAX_WRITES) {
      writes.set(userId, recent);
      return Math.max(1, Math.ceil((recent[0]! + WINDOW_MS - now) / 1000));
    }
    writes.set(userId, [...recent, now]);
    return 0;
  };

  const refuse = (c: { json: (data: unknown, status: 409 | 422 | 429, headers?: Record<string, string>) => Response }, e: StatementRefusal) =>
    c.json({ error: e.message, code: e.code, ...e.detail }, e.status);

  app.get("/statements", async (c) => c.json({ statements: await statementsView(s, c.get("user").id) }));

  // the whole set of rows of one bill replaces what was there; the client sends a period, the statement's sum and rows of day, cents and text
  app.put("/statements/:billId", async (c) => {
    const userId = c.get("user").id;
    const wait = limited(userId);
    if (wait) return c.json({ error: "Liian monta tallennusta. Yritä hetken päästä uudelleen.", code: "rate_limited" }, 429, { "Retry-After": String(wait) });
    try {
      await saveStatement(s, userId, c.req.param("billId"), parseStatement(await body(c)));
    } catch (e) {
      if (e instanceof StatementRefusal) return refuse(c, e);
      throw e;
    }
    const mine = (await statementsView(s, userId)) as { billId: string }[];
    return c.json({ statement: mine.find((x) => x.billId === c.req.param("billId")) });
  });

  // undo per bill: the bill counts whole again
  app.delete("/statements/:billId", async (c) => {
    const userId = c.get("user").id;
    const wait = limited(userId);
    if (wait) return c.json({ error: "Liian monta tallennusta. Yritä hetken päästä uudelleen.", code: "rate_limited" }, 429, { "Retry-After": String(wait) });
    await removeStatement(s, userId, c.req.param("billId"));
    await syncStatementState(s, userId);
    return c.json({ ok: true });
  });

  app.all("/statements/*", () => {
    throw new NotFound("Ei löydy.");
  });

  return app;
}
