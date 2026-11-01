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
import { noticesView, saveNotices } from "../services/outside-notices.ts";
import { makeKeys, offsiteView, removeOffsite, runOffsiteNow, saveOffsite } from "../services/offsite.ts";
import { recordEvent } from "../services/security.ts";
import { startLookup } from "../services/industry.ts";
import { startPriceIndex } from "../services/price-index.ts";
import { listServiceTokens, revokeServiceToken } from "../services/service-tokens.ts";
import { remoteAccessState, removeToken, saveToken, turnOff, turnOn } from "../services/remote-access.ts";
import { unopenedViews } from "../services/view-opens.ts";
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

  /** The views no member opened for a quarter, with their last day (services/view-opens.ts). */
  app.get("/unopened-views", async (c) => c.json(await unopenedViews(s)));

  app.put("/instance", async (c) => {
    const wasOn = s.instance.current.industryLookup;
    const indexWasOn = s.instance.current.priceIndex;
    const saved = await s.instance.save(await body(c));
    // names that waited while it was off are looked up now
    if (saved.industryLookup && !wasOn) startLookup(s);
    if (saved.priceIndex && !indexWasOn) startPriceIndex(s);
    return c.json(await state());
  });

  /** The numeric limits (platform/limits.ts) with their layers; a change holds from the next request and is a security event. */
  app.get("/limits", (c) => c.json({ limits: s.instance.limits.view() }));

  app.put("/limits", async (c) => {
    await s.instance.load();
    const { changed, restart } = await s.instance.limits.save(await body(c));
    if (changed.length) {
      await recordEvent(s, { kind: "limits_changed", userId: c.get("user").id, ...requestInfo(c, s), detail: changed.map((x) => `${x.key} ${x.from} > ${x.to}`).join(", ") });
    }
    return c.json({ limits: s.instance.limits.view(), restart });
  });

  /** Notices outside the browser (services/outside-notices.ts). The address and the token go in and never come out. */
  app.get("/notices", async (c) => c.json(await noticesView(s)));

  app.put("/notices", async (c) => c.json(await saveNotices(s, strictObject(await body(c), ["enabled", "address", "token"] as const), { userId: c.get("user").id, language: c.get("user").language, ...requestInfo(c, s) })));

  /** The encrypted copy to another machine (services/offsite.ts). Every change asks for the admin's password; the keys never come out but the SSH public line and the age secret once. */
  app.get("/offsite", async (c) => c.json(await offsiteView(s, c.get("user").language)));
  const offsiteWho = (c: Parameters<typeof requestInfo>[0]) => ({ user: c.get("user"), req: requestInfo(c, s) });
  app.post("/offsite/keys", async (c) => c.json(await makeKeys(s, offsiteWho(c), strictObject(await body(c), ["password"] as const).password)));
  app.put("/offsite", async (c) => c.json(await saveOffsite(s, offsiteWho(c), strictObject(await body(c), ["password", "enabled", "host", "port", "user", "dir", "recipient", "keyConfirmed"] as const))));
  app.post("/offsite/run", async (c) => c.json(await runOffsiteNow(s, offsiteWho(c), strictObject(await body(c), ["password"] as const).password)));
  app.delete("/offsite", async (c) => c.json(await removeOffsite(s, offsiteWho(c), strictObject(await body(c), ["password"] as const).password)));

  /** Service tokens (services/service-tokens.ts): listed and removed here, made only on the command line. */
  app.get("/service-tokens", async (c) => {
    const tokens = await listServiceTokens(s);
    return c.json({ tokens: tokens.map(({ id, username, name, createdAt, expiresAt, lastUsedAt, lastUsedIp }) => ({ id, username, name, createdAt, expiresAt, lastUsedAt, lastUsedIp })) });
  });

  app.delete("/service-tokens/:id", async (c) => {
    if (!(await revokeServiceToken(s, c.req.param("id"), c.get("user").username, requestInfo(c, s)))) throw new UserError("Palvelutunnusta ei löydy.");
    return c.json({ ok: true });
  });

  /** Feature flags: a partial map of ids of the extensions' flags to on or off. */
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

  /** Finishes the wizard (the "Tee myöhemmin" button writes nothing); everything stays editable in the settings. */
  app.post("/instance/complete", async (c) => {
    const before = s.instance.current.setupDone;
    await s.instance.completeSetup();
    await recordEvent(s, { kind: "setup_completed", userId: c.get("user").id, ...requestInfo(c, s), detail: before ? "uudelleen, käyttöönotto oli jo valmis" : null });
    return c.json(await state());
  });

  // ── the household's shared Enable Banking application ──
  app.post("/bank-app/key", async (c) => {
    await generatePendingKey(s, { userId: c.get("user").id, req: requestInfo(c, s) });
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
    const result = await activateBankApp(s, await body(c), { userId: c.get("user").id, req: requestInfo(c, s) });
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
    await removeBankApp(s, { userId: c.get("user").id, req: requestInfo(c, s) });
    return c.json(await state());
  });

  // ── remote access through Cloudflare (services/remote-access.ts): every answer is the state the page shows ──

  app.get("/remote-access", async (c) => c.json(await remoteAccessState(s, c.get("user").language)));

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
