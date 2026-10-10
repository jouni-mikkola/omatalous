/**
 * Instance setup for admins: the first-run wizard and Asetukset > Palvelin.
 * Every body is a strict JSON object (unknown keys are refused) and every
 * value is validated against an allowlist in platform/validate.ts or
 * connectors/enable-banking/app-setup.ts before anything is stored.
 */
import { Hono } from "hono";
import { activateBankApp, bankAppStatus, checkAppId, downloadableCertificate, generatePendingKey, removeBankApp, testBankApp } from "../connectors/enable-banking/app-setup.ts";
import type { AppEnv, Services } from "../services/context.ts";
import { UserError } from "../platform/errors.ts";
import { strictObject } from "../platform/validate.ts";
import { startLookup } from "../services/industry.ts";
import { body } from "./shared.ts";

export function adminRoutes(s: Services) {
  const app = new Hono<AppEnv>();

  const state = async () => ({
    settings: s.instance.current,
    // every flag with its resolved state, for the switches in Asetukset > Palvelin
    features: s.instance.features(),
    bankApp: await bankAppStatus(s),
    secret: { available: !!s.config.appSecret },
  });

  app.get("/instance", async (c) => c.json(await state()));

  app.put("/instance", async (c) => {
    const wasOn = s.instance.current.industryLookup;
    const saved = await s.instance.save(await body(c));
    // names that waited while it was off are looked up now
    if (saved.industryLookup && !wasOn) startLookup(s);
    return c.json(await state());
  });

  /** Feature flags: a partial map of ids from core's FEATURES to on or off. */
  app.put("/features", async (c) => {
    await s.instance.setFeatures(await body(c));
    return c.json(await state());
  });

  /** Plain-http installs: use the project's return page (relay) or paste the address after the bank login (paste). */
  app.put("/instance/redirect-mode", async (c) => {
    const { mode } = strictObject(await body(c), ["mode"] as const);
    await s.instance.setRedirectMode(mode);
    return c.json(await state());
  });

  /** Finishes (or skips) the wizard; everything stays editable in the settings. */
  app.post("/instance/complete", async (c) => {
    await s.instance.completeSetup();
    return c.json(await state());
  });

  // ── the household's shared Enable Banking application ──
  app.post("/bank-app/key", async (c) => {
    await generatePendingKey(s);
    return c.json(await state());
  });

  /** The public certificate to upload to Enable Banking. Never the private key. */
  app.get("/bank-app/certificate", async (c) => {
    const pem = await downloadableCertificate(s);
    if (!pem) throw new UserError("Varmennetta ei ole. Luo avain ensin.");
    return c.body(pem, 200, {
      "Content-Type": "application/x-pem-file",
      "Content-Disposition": 'attachment; filename="talous-enablebanking.crt"',
    });
  });

  app.put("/bank-app", async (c) => {
    const result = await activateBankApp(s, await body(c));
    return c.json({ ...(await state()), result });
  });

  /** Tries a pasted Application ID without saving it. */
  app.post("/bank-app/check", async (c) => c.json(await checkAppId(s, await body(c))));

  app.post("/bank-app/test", async (c) => {
    return c.json({ ...(await state()), result: await testBankApp(s) });
  });

  app.delete("/bank-app", async (c) => {
    await removeBankApp(s);
    return c.json(await state());
  });

  return app;
}
