import { generateKeyPairSync, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runCli } from "../src/cli.ts";
import { BACKUP_MAX_AGE_DAYS, openDatabase, pruneBackupsByAge } from "../src/db/open.ts";
import { rotateAppSecret } from "../src/entry/secret-rotate.ts";
import { SecretBox } from "../src/security/secretbox.ts";
import { AAD } from "../src/services/bank-app.ts";
import { foldCsvAccounts } from "../src/services/bank.ts";
import { resealAll } from "../src/services/secret-rotation.ts";
import { mockBank } from "./mock-bank.ts";
import { NOW, setupApp } from "./helpers.ts";

const pem = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const dirs: string[] = [];
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), "talous-life-"));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const callback = (state: string) => ({ url: `https://x.example/cb?code=abc&state=${state}` });

describe("removing a member", () => {
  it("ends their bank consents first, then removes the data", async () => {
    const bank = mockBank();
    const { admin, member, s } = await setupApp({ EB_APP_ID: randomUUID(), EB_PRIVATE_KEY: pem }, bank.fetchMock);
    const eero = await member("eero");
    await eero.call("POST", "/api/connections/start", {});
    await eero.call("POST", "/api/connections/complete", callback(bank.state));
    const [conn] = await s.finance(eero.id).listConnections();

    const r = await admin.call("DELETE", `/api/users/${eero.id}`);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, revoked: 1, failed: 0 });
    expect(bank.calls).toContain(`DELETE /sessions/${conn!.id}`);
    expect(await s.users.get(eero.id)).toBeNull();
    const kinds = (await s.security.list({ limit: 50 })).map((e) => e.kind);
    expect(kinds).toContain("user_deleted");
  });

  it("goes on when the bank refuses, and says how many consents are left to expire", async () => {
    const bank = mockBank();
    const { admin, member, s } = await setupApp({ EB_APP_ID: randomUUID(), EB_PRIVATE_KEY: pem }, bank.fetchMock);
    const eero = await member("eero");
    await eero.call("POST", "/api/connections/start", {});
    await eero.call("POST", "/api/connections/complete", callback(bank.state));
    bank.status = 401;
    const r = await admin.call("DELETE", `/api/users/${eero.id}`);
    expect(r.body).toMatchObject({ ok: true, revoked: 0, failed: 1 });
    expect(await s.users.get(eero.id)).toBeNull();
  });

  it("leaves no trace of their rows in the database file or its log", async () => {
    const root = tmp();
    const path = join(root, "banking.db");
    const { db } = await openDatabase(path);
    const { admin, member } = await setupApp({}, undefined, { db });
    const eero = await member("eero");
    const marker = "ZXQVMARKERKAUPPA";
    const rows = Array.from({ length: 40 }, (_, i) => `2026/09/${String((i % 28) + 1).padStart(2, "0")};-${i + 1},00;${marker} ${i}`).join("\n");
    const imported = await eero.call("POST", "/api/import/csv", { content: `Kirjauspäivä;Määrä;Nimi\n${rows}\n`, accountName: "Tili" });
    expect(imported.status).toBe(200);
    expect(readFileSync(path).includes(marker) || readFileSync(`${path}-wal`).includes(marker)).toBe(true);

    expect((await admin.call("DELETE", `/api/users/${eero.id}`)).status).toBe(200);
    const wal = existsSync(`${path}-wal`) ? readFileSync(`${path}-wal`) : Buffer.alloc(0);
    expect(readFileSync(path).includes(marker)).toBe(false);
    expect(wal.includes(marker)).toBe(false);
    expect(await db.first<{ secure_delete: number }>("PRAGMA secure_delete")).toEqual({ secure_delete: 1 });
  });
});

describe("database copies are pruned by age", () => {
  it("removes auto and pre copies past the limit but keeps the newest pre copy", () => {
    const root = tmp();
    const dir = join(root, "backups");
    mkdirSync(dir);
    const put = (name: string, daysAgo: number) => {
      writeFileSync(join(dir, name), "x");
      const t = (NOW.getTime() - daysAgo * 86_400_000) / 1000;
      utimesSync(join(dir, name), t, t);
    };
    put("auto-2026-09-01.db", 38);
    put("auto-2026-09-30.db", 9);
    put("pre-0004_x-20260801T000000.db", 69);
    put("pre-update-20260815T000000.db", 55);
    put("notes.txt", 100);
    expect(BACKUP_MAX_AGE_DAYS).toBe(14);
    const removed = pruneBackupsByAge(root, NOW);
    expect(removed.sort()).toEqual(["auto-2026-09-01.db", "pre-0004_x-20260801T000000.db"]);
    expect(readdirSync(dir).sort()).toEqual(["auto-2026-09-30.db", "notes.txt", "pre-update-20260815T000000.db"]);
    // a newer pre copy replaces the old one
    put("pre-update-20261008T000000.db", 1);
    expect(pruneBackupsByAge(root, NOW)).toEqual(["pre-update-20260815T000000.db"]);
  });

  it("does nothing without a backups directory", () => {
    expect(pruneBackupsByAge(tmp(), NOW)).toEqual([]);
  });
});

describe("stored instance settings from before industryLookup existed", () => {
  it("turn the register lookup off, tell admins once, and stay off", async () => {
    const t = await setupApp({ INDUSTRY_LOOKUP: "true" });
    // a 0.2.0 row: no industryLookup key
    await t.s.settings.set("instance_settings", JSON.stringify({ appBaseUrl: "http://localhost:8080", timezone: "Europe/Helsinki", syncHours: [6, 18], historyDays: 730, setupDone: true }));
    const state = await t.s.instance.load(true);
    expect(state.industryLookup).toBe(false);
    expect(JSON.parse((await t.s.settings.get("instance_settings"))!).industryLookup).toBe(false);

    const notices = (await t.admin.call("GET", "/api/security/notices")).body.notices as { kind: string; text: string }[];
    expect(notices.find((n) => n.kind === "industry_lookup_off")?.text).toContain("Asetukset > Palvelin");
    expect((await t.admin.call("GET", "/api/admin/instance")).body.settings.industryLookup).toBe(false);

    await t.admin.call("POST", "/api/security/notices/seen", {});
    expect(((await t.admin.call("GET", "/api/security/notices")).body.notices as { kind: string }[]).some((n) => n.kind === "industry_lookup_off")).toBe(false);
    // loading again does not bring the notice back
    await t.s.instance.load(true);
    expect(await t.s.settings.get("notice_industry_lookup_off")).toBeNull();
    // an admin can turn it on afterwards
    expect((await t.admin.call("PUT", "/api/admin/instance", { industryLookup: true })).body.settings.industryLookup).toBe(true);
  });

  it("members do not see the admin notice, and a fresh install keeps the default", async () => {
    const t = await setupApp({ INDUSTRY_LOOKUP: "true" });
    await t.s.settings.set("instance_settings", JSON.stringify({ appBaseUrl: "http://localhost:8080", timezone: "Europe/Helsinki", syncHours: [6], historyDays: 730 }));
    await t.s.instance.load(true);
    const eero = await t.member("eero");
    expect(((await eero.call("GET", "/api/security/notices")).body.notices as { kind: string }[]).some((n) => n.kind === "industry_lookup_off")).toBe(false);

    const fresh = await setupApp({ INDUSTRY_LOOKUP: "true" });
    expect((await fresh.admin.call("GET", "/api/admin/instance")).body.settings.industryLookup).toBe(true);
    expect(await fresh.s.settings.get("notice_industry_lookup_off")).toBeNull();
  });
});

describe("a CSV account and a later bank account with the same IBAN", () => {
  const HEAD = "Kirjauspäivä;Määrä;Maksaja;Maksunsaaja;Nimi;Otsikko;Viitenumero;Valuutta";
  const IBAN = "FI21 1234 5600 0007 85";
  const csvFile = [
    HEAD,
    `2026/09/25;3420,00;FI98 1234 5600 0000 18;${IBAN};ACME OY;PALKKA;;EUR`,
    `2026/08/20;-50,00;${IBAN};;K-MARKET;KORTTIOSTO;;EUR`,
    `2026/08/20;-50,00;${IBAN};;K-MARKET;KORTTIOSTO;;EUR`,
  ].join("\n");

  async function connectAfterCsv() {
    const bank = mockBank();
    const t = await setupApp({ EB_APP_ID: randomUUID(), EB_PRIVATE_KEY: pem }, bank.fetchMock);
    const imported = await t.admin.call("POST", "/api/import/csv", { content: csvFile, accountName: "Käyttötili CSV", accountType: "checking" });
    expect(imported.body).toMatchObject({ inserted: 3 });
    await t.admin.call("POST", "/api/connections/start", {});
    await t.admin.call("POST", "/api/connections/complete", callback(bank.state));
    return { ...t, bank, csvAccountId: imported.body.accountId as string };
  }

  it("become one account and count each payment once", async () => {
    const { admin, csvAccountId, s, adminId } = await connectAfterCsv();
    const accounts = (await admin.call("GET", "/api/meta")).body.accounts as { id: string; provider?: string; iban: string | null; name: string }[];
    expect(accounts.map((a) => a.id)).not.toContain(csvAccountId);
    expect(accounts.filter((a) => a.iban === "FI2112345600000785")).toHaveLength(1);
    expect(await s.finance(adminId).getAccount(csvAccountId)).toBeNull();

    await admin.call("POST", "/api/sync");
    const d = (await admin.call("GET", "/api/dashboard?from=2026-08-01&to=2026-10-09")).body;
    // the salary is in the CSV and at the bank: once; the card account adds its own spending
    expect(d.totals.incomeCents).toBe(342000);
    const all = (await admin.call("GET", "/api/transactions?from=2026-08-01&to=2026-10-09&limit=100")).body.items as { description: string | null; amountCents: number }[];
    expect(all.filter((t) => t.amountCents === 342000)).toHaveLength(1);
    expect(all.filter((t) => t.amountCents === -5000)).toHaveLength(2); // two identical rows stay two
  });

  it("a later import of the same file into the merged account adds nothing", async () => {
    const { admin, accountsAfter } = await (async () => {
      const t = await connectAfterCsv();
      const accounts = (await t.admin.call("GET", "/api/meta")).body.accounts as { id: string; iban: string | null }[];
      return { ...t, accountsAfter: accounts };
    })();
    const merged = accountsAfter.find((a) => a.iban === "FI2112345600000785")!;
    const again = await admin.call("POST", "/api/import/csv", { content: csvFile, accountId: merged.id });
    expect(again.status).toBe(200);
    expect(again.body.inserted).toBe(0);
  });

  it("keeps the user's own category choice and shares of the CSV account", async () => {
    const bank = mockBank();
    const t = await setupApp({ EB_APP_ID: randomUUID(), EB_PRIVATE_KEY: pem }, bank.fetchMock);
    const eero = await t.member("eero");
    const imported = await t.admin.call("POST", "/api/import/csv", { content: csvFile, accountName: "Käyttötili CSV" });
    const csvId = imported.body.accountId as string;
    await t.admin.call("PUT", `/api/accounts/${csvId}/shares/${eero.id}`);
    const row = ((await t.admin.call("GET", "/api/transactions?q=k-market")).body.items as { id: string }[])[0]!;
    await t.admin.call("PATCH", `/api/transactions/${row.id}`, { category: "groceries" });
    await t.admin.call("POST", "/api/connections/start", {});
    await t.admin.call("POST", "/api/connections/complete", callback(bank.state));
    const accounts = (await t.admin.call("GET", "/api/meta")).body.accounts as { id: string; iban: string | null }[];
    const merged = accounts.find((a) => a.iban === "FI2112345600000785")!;
    const shared = (await eero.call("GET", "/api/meta")).body.sharedAccounts as { id: string }[];
    expect(shared.map((a) => a.id)).toContain(merged.id);
    const moved = ((await t.admin.call("GET", "/api/transactions?q=k-market")).body.items as { category: string; categorySource: string }[]);
    expect(moved.some((m) => m.category === "groceries" && m.categorySource === "user")).toBe(true);
    expect(await foldCsvAccounts(t.s.finance(t.adminId))).toBe(0);
  });
});

describe("command line: sessions and secret rotation", () => {
  it("sessions revoke-all signs everyone out", async () => {
    const { admin, member, s } = await setupApp();
    const eero = await member("eero");
    expect(await runCli(s, ["sessions", "revoke-all"])).toBe(0);
    expect((await admin.call("GET", "/api/meta")).status).toBe(401);
    expect((await eero.call("GET", "/api/meta")).status).toBe(401);
    expect((await s.security.list({ kind: "session_revoked", limit: 5 })).length).toBe(1);
  });

  async function sealed() {
    const t = await setupApp();
    await t.admin.call("PUT", "/api/bank/credentials", { appId: randomUUID(), privateKeyPem: pem });
    await t.admin.call("POST", "/api/admin/bank-app/key", {});
    const dir = tmp();
    const file = join(dir, "app_secret");
    writeFileSync(file, `${t.s.config.appSecret}\n`, { mode: 0o600 });
    return { ...t, dir, file, oldSecret: t.s.config.appSecret! };
  }

  it("re-seals user and shared keys under a new secret and swaps the file", async () => {
    const t = await sealed();
    const beforeUser = (await t.s.users.getBankCredentials(t.adminId))!.privateKeyEnc;
    const lines = await rotateAppSecret(t.s, { secretFile: t.file, snapshot: () => "snap.db" });
    expect(lines.join("\n")).toContain("1 käyttäjän avainta, 1 yhteistä avainta");
    const newSecret = readFileSync(t.file, "utf8").trim();
    expect(newSecret).not.toBe(t.oldSecret);
    expect(newSecret.length).toBeGreaterThanOrEqual(32);
    expect(statSync(t.file).mode & 0o777).toBe(0o600);
    expect(existsSync(`${t.file}.next`)).toBe(false);
    const prev = readdirSync(t.dir).find((f) => f.startsWith("app_secret.prev-"))!;
    expect(readFileSync(join(t.dir, prev), "utf8").trim()).toBe(t.oldSecret);

    const after = (await t.s.users.getBankCredentials(t.adminId))!.privateKeyEnc;
    expect(after).not.toBe(beforeUser);
    const nb = await SecretBox.fromSecret(newSecret);
    const ob = await SecretBox.fromSecret(t.oldSecret);
    expect(await nb.open(after, t.adminId)).toContain("PRIVATE KEY");
    await expect(ob.open(after, t.adminId)).rejects.toThrow();
    const pending = JSON.parse((await t.s.settings.get("instance_bank_app_pending"))!) as { keyEnc: string };
    expect(await nb.open(pending.keyEnc, AAD)).toContain("PRIVATE KEY");
  });

  it("changes nothing when one key cannot be opened", async () => {
    const t = await sealed();
    await t.s.db.run("UPDATE bank_credentials SET private_key_enc = ? WHERE user_id = ?", ["v1.AAAA.BBBB", t.adminId]);
    const pendingBefore = await t.s.settings.get("instance_bank_app_pending");
    await expect(resealAll(t.s, t.oldSecret, "another-secret-that-is-long-enough-0123456789")).rejects.toThrow(/Mitään ei muutettu/);
    expect(await t.s.settings.get("instance_bank_app_pending")).toBe(pendingBefore);
  });

  it("finishes a run that stopped after the database was re-sealed", async () => {
    const t = await sealed();
    const next = "interrupted-new-secret-long-enough-0123456789";
    writeFileSync(`${t.file}.next`, `${next}\n`, { mode: 0o600 });
    await resealAll(t.s, t.oldSecret, next); // step 2 done, step 3 not
    const lines = await rotateAppSecret(t.s, { secretFile: t.file, snapshot: () => "snap.db" });
    expect(lines.join("\n")).toContain("jatketaan");
    expect(readFileSync(t.file, "utf8").trim()).toBe(next);
    expect(existsSync(`${t.file}.next`)).toBe(false);
  });

  it("finishes a run that stopped before the database was touched", async () => {
    const t = await sealed();
    const next = "interrupted-new-secret-long-enough-0123456789";
    writeFileSync(`${t.file}.next`, `${next}\n`, { mode: 0o600 });
    await rotateAppSecret(t.s, { secretFile: t.file, snapshot: () => "snap.db" });
    expect(readFileSync(t.file, "utf8").trim()).toBe(next);
    expect(await (await SecretBox.fromSecret(next)).open((await t.s.users.getBankCredentials(t.adminId))!.privateKeyEnc, t.adminId)).toContain("PRIVATE KEY");
  });

  it("refuses when the secret comes from the environment", async () => {
    const { s } = await setupApp();
    expect(await runCli(s, ["secret", "rotate"], {})).toBe(1);
  });
});
