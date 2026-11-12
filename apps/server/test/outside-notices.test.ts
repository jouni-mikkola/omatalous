import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Statfs } from "../src/db/backup-keep.ts";
import { deliverNotices } from "../src/services/outside-notices.ts";
import { takeWatchdog } from "../src/services/ops-watchdog.ts";
import { hourlyTick } from "../src/services/schedule.ts";
import { scratchDir, setupApp } from "./helpers.ts";

/** The titles an admin reads, written out here so a change of wording is a change of this test. */
const TEXTS = {
  consent: { title: "Pankkisuostumus päättyy pian", message: "Uusi suostumus ennen kuin pankin haku pysähtyy. Katso Asetukset > Pankit ja tilit." },
  disk: { title: "Palvelimen levy on lähes täynnä", message: "Siivoa levy ennen kuin tallennus pysähtyy. Katso Asetukset > Palvelin ja ylläpito." },
  backup: { title: "Varmuuskopio ei ole kunnossa", message: "Ehjää varmuuskopiota ei ole tuoreena. Ota uusi kopio kohdassa Asetukset > Palvelin ja ylläpito." },
  update: { title: "Päivitys palautettiin", message: "Edellinen versio palautettiin, koska päivitys ei onnistunut. Katso Asetukset > Palvelin ja ylläpito." },
};
const WEBHOOK = "https://hooks.example.org/in/9f8e7d6c5b4a";
const ROOMY: Statfs = () => ({ bavail: 50_000 * 256, bsize: 4096 });
const FULL: Statfs = () => ({ bavail: 100 * 256, bsize: 4096 });

interface Call {
  url: string;
  auth: string | null;
  body: Record<string, string>;
}

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

/** An app whose outside calls go to a fake receiver that records them. A new install: no copy is missing yet. */
async function household(status = 200) {
  const calls: Call[] = [];
  const fake = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), auth: new Headers(init?.headers).get("authorization"), body: JSON.parse(String(init?.body)) });
    return new Response("", { status });
  }) as typeof fetch;
  const dir = scratchDir("talous-notices-");
  dirs.push(dir);
  mkdirSync(join(dir, "backups"));
  const app = await setupApp({}, fake, { backupDir: join(dir, "backups") });
  const put = (body: unknown) => app.admin.call("PUT", "/api/admin/notices", body);
  return { ...app, calls, put };
}

describe("notices outside the browser", () => {
  it("sends nothing while the setting is off, however much is wrong", async () => {
    const h = await household();
    await takeWatchdog(h.s, { watchdog: { at: "2026-10-09T09:40:00Z", from: "0.9.1", to: "0.9.0", reason: "unhealthy" } });
    expect(await deliverNotices(h.s, { statfs: FULL })).toBe(0);
    // an address saved but not turned on sends nothing either
    expect((await h.put({ address: WEBHOOK })).status).toBe(200);
    expect(await deliverNotices(h.s, { statfs: FULL })).toBe(0);
    await hourlyTick(h.s);
    expect(h.calls).toEqual([]);
  });

  it("sends the disk and the update notice once each", async () => {
    const h = await household();
    expect((await h.put({ enabled: true, address: WEBHOOK, token: "tok-123" })).status).toBe(200);
    await takeWatchdog(h.s, { watchdog: { at: "2026-10-09T09:40:00Z", from: "0.9.1", to: "0.9.0", reason: "unhealthy" } });
    expect(await deliverNotices(h.s, { statfs: FULL })).toBe(2);
    expect(await deliverNotices(h.s, { statfs: FULL })).toBe(0);
    expect(h.calls.map((c) => c.body)).toEqual([
      { event: "disk", ...TEXTS.disk },
      { event: "update", ...TEXTS.update },
    ]);
    expect(h.calls.every((c) => c.url === WEBHOOK && c.auth === "Bearer tok-123")).toBe(true);
  });

  it("sends the consent notice for a bank ending within two weeks and the backup notice for a missing copy", async () => {
    const h = await household();
    h.db.exec(`UPDATE users SET created_at = '2026-09-01T00:00:00Z'`);
    const repo = h.s.finance(h.adminId);
    const consent = (id: string, validUntil: string) => repo.upsertConnection({ id, provider: "enablebanking", institution: "Nordea", country: "FI", status: "active", validUntil, createdAt: "2026-04-01T00:00:00Z", lastSyncedAt: null });
    await consent("soon", "2026-10-15T00:00:00Z");
    await consent("far", "2027-03-01T00:00:00Z");
    for (const id of ["soon", "far"]) await repo.upsertAccount({ id: `a-${id}`, connectionId: id, provider: "enablebanking", externalId: null, identity: id, name: id, iban: null, currency: "EUR", type: "checking" });
    await h.put({ enabled: true, address: "koti-ilmoitukset" });
    expect(await deliverNotices(h.s, { statfs: ROOMY })).toBe(2);
    expect(await deliverNotices(h.s, { statfs: ROOMY })).toBe(0);
    expect(h.calls.map((c) => [c.url, c.body.topic, c.body.title]).sort()).toEqual([
      ["https://ntfy.sh/", "koti-ilmoitukset", TEXTS.consent.title],
      ["https://ntfy.sh/", "koti-ilmoitukset", TEXTS.backup.title],
    ]);
  });

  it("tries a failed send again at the next tick, and leaves no sum, number or name in any text", async () => {
    const h = await household(500);
    await h.put({ enabled: true, address: WEBHOOK });
    expect(await deliverNotices(h.s, { statfs: FULL })).toBe(0);
    expect(h.calls).toHaveLength(1);
    expect(await deliverNotices(h.s, { statfs: FULL })).toBe(0);
    expect(h.calls).toHaveLength(2);
    for (const t of Object.values(TEXTS)) expect(`${t.title} ${t.message}`).not.toMatch(/\d|€|FI\d\d/);
  });
});

describe("the setting", () => {
  it("never returns the address or the token, keeps them sealed, and writes a security event without them", async () => {
    const h = await household();
    const saved = await h.put({ enabled: true, address: WEBHOOK, token: "tok-secret-9" });
    expect(saved.body).toEqual({ enabled: true, configured: true, kind: "webhook", host: "hooks.example.org", hasToken: true, secret: { available: true } });
    expect(JSON.stringify((await h.admin.call("GET", "/api/admin/notices")).body)).not.toMatch(/9f8e7d6c|tok-secret/);
    const stored = (await h.s.settings.get("instance_notices"))!;
    expect(stored).not.toMatch(/hooks\.example|9f8e7d6c|tok-secret/);
    const events = JSON.stringify(await h.s.security.list({ kind: "notices_changed", limit: 10 }));
    expect(events).toContain("päälle, osoite, tunniste");
    expect(events).not.toMatch(/9f8e7d6c|tok-secret|hooks\.example/);
    // taken from the stored row and put under another context it does not open
    const box = (await h.s.secretBox())!;
    await expect(box.open(JSON.parse(stored).keyEnc, "instance:cloudflare")).rejects.toThrow();
    expect((await h.put({ token: null })).body.hasToken).toBe(false);
  });

  it("refuses an address that is not an https address or a topic, a body with other fields, and turning on with no address", async () => {
    const h = await household();
    for (const address of ["http://hooks.example.org/x", "https://localhost/x", "https://127.0.0.1/x", "https://user:pw@hooks.example.org/", "ftp://a.example.org", "a b", "", 5, "https://hooks"]) {
      expect((await h.put({ address })).status, String(address)).toBe(400);
    }
    expect((await h.put({ other: 1 })).status).toBe(400);
    expect((await h.put({ enabled: true })).status).toBe(400);
    expect((await h.put({ enabled: "yes", address: WEBHOOK })).status).toBe(400);
  });

  it("is for admins only", async () => {
    const h = await household();
    const m = await h.member("jasen");
    expect((await m.call("PUT", "/api/admin/notices", { enabled: false })).status).toBe(403);
    expect((await m.call("GET", "/api/admin/notices")).status).toBe(403);
  });
});

describe("a save that opens nothing", () => {
  it("keeps the stored value when only the switch changes, and refuses .localhost and .local names", async () => {
    const h = await household();
    await h.put({ enabled: true, address: WEBHOOK });
    const before = (await h.s.settings.get("instance_notices"))!;
    expect((await h.put({ enabled: false })).status).toBe(200);
    expect(JSON.parse((await h.s.settings.get("instance_notices"))!).keyEnc).toBe(JSON.parse(before).keyEnc);
    for (const address of ["https://foo.localhost/x", "https://nas.local/x"]) expect((await h.put({ address })).status, address).toBe(400);
  });
});

describe("a token stays with its address", () => {
  it("sends no old token to a new address", async () => {
    const h = await household();
    await h.put({ enabled: true, address: WEBHOOK, token: "tok-old-1234567890" });
    expect((await h.put({ address: "https://hooks.example.org/other" })).body.hasToken).toBe(false);
  });
});
