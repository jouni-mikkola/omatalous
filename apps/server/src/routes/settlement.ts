/**
 * The settlement between partners: a month's figures for the pools the member is weighted in, the dated agreements of
 * such a pool, and (for the admin) the household members who have no login.
 */
import { Hono } from "hono";
import { strictObject } from "../platform/validate.ts";
import type { AppEnv, Services } from "../services/context.ts";
import { addAgreement, agreementsOf, listMembers, parseMonth, removeAgreement, saveMembers, settlementsOf } from "../services/settlement.ts";
import { body } from "./shared.ts";

export function settlementRoutes(s: Services) {
  const app = new Hono<AppEnv>();

  // the pools the member is weighted in and nobody else's; a pool with no trace is left out
  app.get("/settlement", async (c) => {
    const month = parseMonth(c.req.query("month") ?? s.today().slice(0, 7));
    return c.json({ month, pools: await settlementsOf(s, c.get("user").id, month) });
  });

  app.get("/settlement/agreements/:accountId", async (c) => c.json(await agreementsOf(s, c.get("user").id, c.req.param("accountId"))));

  // a row from a day; an earlier row is never rewritten, and a day that has one is refused
  app.put("/settlement/agreements/:accountId", async (c) => {
    const input = strictObject(await body(c), ["validFrom", "kind", "value"] as const);
    return c.json(await addAgreement(s, c.get("user").id, c.req.param("accountId"), { validFrom: input.validFrom, kind: input.kind, value: input.value }));
  });

  // a row that waits for a partner, declined by a user it names or withdrawn by the one who put it
  app.delete("/settlement/agreements/:accountId/:validFrom", async (c) => c.json(await removeAgreement(s, c.get("user").id, c.req.param("accountId"), c.req.param("validFrom"))));

  return app;
}

/** Mounted under /api/admin, which only an admin reaches. */
export function householdMemberRoutes(s: Services) {
  const app = new Hono<AppEnv>();
  app.get("/household-members", async (c) => c.json({ members: await listMembers(s) }));
  app.put("/household-members", async (c) => c.json({ members: await saveMembers(s, strictObject(await body(c), ["members"] as const).members) }));
  return app;
}
