/**
 * Instance setup for admins: the first-run wizard and Asetukset > Palvelin.
 * Every body is a strict JSON object (unknown keys are refused) and every
 * value is validated against an allowlist in platform/validate.ts or
 * connectors/enable-banking/app-setup.ts before anything is stored.
 * For remote access (the /remote-access routes) the route checks the keys of
 * the body, and services/remote-access.ts checks each value and asks for the
 * admin's password on each change.
 */
import { Hono } from "hono";
import { bankCapabilities } from "../connectors/enable-banking/capabilities.ts";
import { activateBankApp, bankAppStatus, checkAppId, downloadableCertificate, generatePendingKey, removeBankApp, testBankApp } from "../connectors/enable-banking/app-setup.ts";
import { testRedirect } from "../connectors/enable-banking/link.ts";
import type { AppEnv, Services } from "../services/context.ts";
import { UserError } from "../platform/errors.ts";
import { strictObject } from "../platform/validate.ts";
import { accessEmail } from "../security/cf-access.ts";
import { startLookup } from "../services/industry.ts";
import { remoteAccessState, removeToken, saveToken, turnOff, turnOn } from "../services/remote-access.ts";
import { body, requestInfo } from "./shared.ts";

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
  /** What each bank supports, from the bank list and from what links and fetches saw (capabilities.ts). Read-only. */
  app.get("/bank-app/capabilities", async (c) => c.json({ banks: await bankCapabilities(s) }));

  app.post("/bank-app/check", async (c) => c.json(await checkAppId(s, await body(c))));

  app.post("/bank-app/test", async (c) => {
    // the test first: it records whether the application is active, and the status below reports that
    const result = await testBankApp(s);
    return c.json({ ...(await state()), result });
  });

  /** Asks Enable Banking to start an authorisation with the configured redirect URL and goes no further. */
  app.post("/bank-app/redirect-test", async (c) => c.json({ result: await testRedirect(s, c.get("user").id) }));

  app.delete("/bank-app", async (c) => {
    await removeBankApp(s);
    return c.json(await state());
  });

  // ── remote access through Cloudflare (services/remote-access.ts): every answer is the state the page shows ──

  app.get("/remote-access", async (c) => c.json(await remoteAccessState(s)));

  /** `{ token, password }`: Cloudflare's API token, tried against Cloudflare and kept sealed. Never sent back. */
  app.put("/remote-access/token", async (c) => c.json(await saveToken(s, c.get("user"), strictObject(await body(c), ["token", "password"] as const), requestInfo(c, s))));

  /** `{ password }` */
  app.delete("/remote-access/token", async (c) => c.json(await removeToken(s, c.get("user"), strictObject(await body(c), ["password"] as const), requestInfo(c, s))));

  /** `{ hostname, emails, password }`: on, or a new list of who may sign in. The address Access verified for this call must stay on it. */
  app.post("/remote-access/on", async (c) => c.json(await turnOn(s, c.get("user"), strictObject(await body(c), ["hostname", "emails", "password"] as const), requestInfo(c, s), accessEmail(c))));

  /** `{ password, localOnly? }`: `localOnly` is the yes to a copy that answers on the server alone afterwards. */
  app.post("/remote-access/off", async (c) => c.json(await turnOff(s, c.get("user"), strictObject(await body(c), ["password", "localOnly"] as const), requestInfo(c, s))));

  return app;
}
