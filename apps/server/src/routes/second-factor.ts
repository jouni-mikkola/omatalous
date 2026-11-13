/** The signed-in user's own second sign-in factor (the sign-in step itself is POST /api/auth/factor, routes/auth.ts). */
import { Hono } from "hono";
import type { AppEnv, Services } from "../services/context.ts";
import { confirmEnrol, factorStatus, remakeRecoveryCodes, removeOwnFactor, startEnrol } from "../services/second-factor.ts";
import { strictObject } from "../platform/validate.ts";
import { body, optionalString, requestInfo } from "./shared.ts";

export function factorRoutes(s: Services) {
  const app = new Hono<AppEnv>();

  app.get("/", async (c) => c.json(await factorStatus(s, c.get("user").id)));

  /** The password, then a new secret as text and as an otpauth:// address for a QR picture; nothing is stored until /confirm. */
  app.post("/enrol", async (c) => {
    const raw = strictObject(await body(c), ["password"] as const);
    return c.json(await startEnrol(s, c.get("user"), optionalString(raw.password, 1024) ?? "", requestInfo(c, s)));
  });

  /** The password and one valid code store the factor; the answer holds the ten recovery codes, shown this once. */
  app.post("/confirm", async (c) => {
    const raw = strictObject(await body(c), ["password", "code"] as const);
    const codes = await confirmEnrol(s, c.get("user"), optionalString(raw.password, 1024) ?? "", optionalString(raw.code, 64) ?? "", c.get("sessionId"), requestInfo(c, s));
    return c.json({ recoveryCodes: codes });
  });

  /** Password and a code (from the app or a recovery code). */
  app.post("/remove", async (c) => {
    const raw = strictObject(await body(c), ["password", "code"] as const);
    await removeOwnFactor(s, c.get("user"), optionalString(raw.password, 1024) ?? "", optionalString(raw.code, 64) ?? "", requestInfo(c, s));
    return c.json({ ok: true });
  });

  /** Ten new recovery codes for password and a code; the old ones stop working. */
  app.post("/recovery-codes", async (c) => {
    const raw = strictObject(await body(c), ["password", "code"] as const);
    return c.json({ recoveryCodes: await remakeRecoveryCodes(s, c.get("user"), optionalString(raw.password, 1024) ?? "", optionalString(raw.code, 64) ?? "", requestInfo(c, s)) });
  });

  return app;
}
