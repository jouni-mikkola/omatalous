/** What money from a payer is: the signed-in user's own answer, read back and changed here. Moves that member's past rows too; a household scope is not accepted. */
import { Hono } from "hono";
import { strictObject } from "../platform/validate.ts";
import type { AppEnv, Services } from "../services/context.ts";
import { answerPayer, parsePayerAnswer, payerAnswers } from "../services/payer-roles.ts";
import { body } from "./shared.ts";

export function payerRoleRoutes(s: Services) {
  const app = new Hono<AppEnv>();

  // the member's own answers only (the household's rows are not theirs to change)
  app.get("/payer-roles", async (c) => c.json({ answers: await payerAnswers(s, c.get("user").id) }));

  // one answer per member and payer; a role of null takes it back and the payer is proposed again. Any other field (a scope, everyone) is a 400
  app.put("/payer-roles", async (c) => {
    const input = strictObject(await body(c), ["key", "role"] as const);
    const answer = parsePayerAnswer({ key: input.key, role: input.role });
    await answerPayer(s, c.get("user").id, answer);
    return c.json({ ok: true });
  });

  return app;
}
