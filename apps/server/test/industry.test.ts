import { generateKeyPairSync, randomUUID } from "node:crypto";
import type { RawTransaction } from "@banking/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { askRegister, drainLookups, lookupIndustries } from "../src/services/industry.ts";
import { ingestTransactions } from "../src/services/ingest.ts";
import { reprocess } from "../src/services/enrich.ts";
import { hourlyTick } from "../src/services/schedule.ts";
import { runUpgradeTasks } from "../src/services/upgrade.ts";
import { PRH_SEARCH_URL, parseCompany, RegistryError, searchCompanies } from "../src/providers/prh/client.ts";
import { seedCsv } from "./csv-seed.ts";
import { NOW, setupApp, waitFor } from "./helpers.ts";
import { mockBank } from "./mock-bank.ts";

afterEach(() => vi.restoreAllMocks());

const company = (businessId: string, names: string[], code: string, codeSet = "TOIMI4") => ({
  businessId: { value: businessId },
  names: names.map((name, i) => ({ name, type: i === 0 ? "1" : "3" })),
  mainBusinessLine: { type: code, typeCodeSet: codeSet, descriptions: [{ languageCode: "1", description: `Toimiala ${code}` }] },
});

const REGISTER: Record<string, unknown[]> = {
  "Pikku Puoti": [company("1234567-1", ["Ilona Ravintolat Oy", "Pikku Puoti"], "56300")],
  "Saumaus Nieminen Oy": [company("2345678-2", ["Saumaus Nieminen Oy"], "43340", "TOIMI3")],
};

/** A fake register that records every name it was asked about. */
function fakeRegister(opts: { fail?: boolean; answer?: (name: string) => Response | null | undefined } = {}) {
  const asked: string[] = [];
  const fetchMock = (async (input: string | URL | Request) => {
    const url = new URL(String(input));
    if (!url.href.startsWith(PRH_SEARCH_URL)) throw new Error(`unexpected request ${url.href}`);
    const name = url.searchParams.get("name")!;
    asked.push(name);
    if (opts.fail) return new Response("busy", { status: 503 });
    const special = opts.answer?.(name);
    if (special !== undefined) return special;
    const companies = REGISTER[name] ?? [];
    return Response.json({ totalResults: companies.length, companies });
  }) as typeof fetch;
  return { asked, fetchMock };
}

const raw = (bookingDate: string, euros: number, counterparty: string, extra: Partial<RawTransaction> = {}): RawTransaction => ({
  externalId: null,
  bookingDate,
  valueDate: null,
  amountCents: Math.round(euros * 100),
  currency: "EUR",
  status: "booked",
  counterparty,
  counterpartyIban: null,
  description: null,
  reference: null,
  mcc: null,
  ...extra,
});

async function withData(fetchMock: typeof fetch, env: Record<string, string> = {}) {
  const t = await setupApp({ INDUSTRY_LOOKUP: "true", ...env }, fetchMock);
  const repo = t.s.finance(t.adminId);
  await repo.upsertAccount({ id: "chk", connectionId: null, provider: "csv", externalId: null, identity: null, name: "Käyttötili", iban: "FI2112345600000785", currency: "EUR", type: "checking" });
  await ingestTransactions(
    repo,
    "chk",
    [
      raw("2026-09-01", -12, "PIKKU PUOTI", { description: "KORTTIOSTO" }),
      raw("2026-09-02", -90, "SAUMAUS NIEMINEN OY", { counterpartyIban: "FI4950009420028730" }),
      // people: by account transfer, or a CSV row without an account number. Never sent anywhere.
      raw("2026-09-03", -50, "LIISA VIRTANEN", { counterpartyIban: "FI4950009420028731" }),
      raw("2026-09-04", -20, "MAIJA NIEMINEN", { description: "SYNTYMÄPÄIVÄLAHJA" }),
    ],
    "csv",
  );
  await reprocess(repo, t.s.settings);
  return { ...t, repo };
}

describe("industry lookup", () => {
  it("categorises unknown businesses from the register and sends only business names", async () => {
    const { asked, fetchMock } = fakeRegister();
    const { s, repo, admin } = await withData(fetchMock);

    const r = await lookupIndustries(s, { pauseMs: 0 });
    expect(r).toMatchObject({ looked: 2, categorised: 2 });
    expect(asked.sort()).toEqual(["Pikku Puoti", "Saumaus Nieminen Oy"]);

    const byMerchant = new Map((await repo.allTransactions()).map((t) => [t.merchant, t]));
    expect(byMerchant.get("Pikku Puoti")).toMatchObject({ category: "restaurants", categorySource: "industry" });
    expect(byMerchant.get("Saumaus Nieminen Oy")).toMatchObject({ category: "home", categorySource: "industry" });
    // people are never asked about: a transfer to a person's account with no reference number is a payment between people, and a row with no account is read as before
    expect(byMerchant.get("Liisa Virtanen")).toMatchObject({ category: "p2p", categorySource: "rule" });
    expect(byMerchant.get("Maija Nieminen")).toMatchObject({ category: "other", categorySource: "default" });

    // the list says where the category came from
    const list = await admin.call("GET", "/api/transactions?merchant=Pikku%20Puoti");
    expect(list.body.items[0].industry).toEqual({ companyName: "Pikku Puoti", businessId: "1234567-1", label: "Toimiala 56300" });

    // answers are kept: the next run asks nothing
    expect(await lookupIndustries(s, { pauseMs: 0 })).toMatchObject({ looked: 0 });
    expect(asked).toHaveLength(2);
  });

  it("does not ask about a person paid twice in older imported rows that have no payee accounts", async () => {
    const { asked, fetchMock } = fakeRegister();
    const t = await setupApp({ INDUSTRY_LOOKUP: "true" }, fetchMock);
    const repo = t.s.finance(t.adminId);
    await repo.upsertAccount({ id: "chk", connectionId: null, provider: "enablebanking", externalId: "u", identity: null, name: "Käyttötili", iban: "FI2112345600000785", currency: "EUR", type: "checking" });
    // the bank's rows carry payee accounts; the CSV imported before it did not
    await ingestTransactions(repo, "chk", [raw("2026-10-02", -900, "SAUMAUS NIEMINEN OY", { externalId: "e1", counterpartyIban: "FI4950009420028730" })], "enablebanking");
    await ingestTransactions(
      repo,
      "chk",
      [raw("2026-09-01", -40, "LIISA VIRTANEN", { description: "SIIRTO" }), raw("2026-09-15", -40, "LIISA VIRTANEN", { description: "SIIRTO" })],
      "csv",
    );
    await reprocess(repo, t.s.settings);
    await lookupIndustries(t.s, { pauseMs: 0 });
    expect(asked).toEqual(["Saumaus Nieminen Oy"]);
  });

  it("does not ask about a person the bank delivers without a payee account, behind a MobilePay prefix or with card text", async () => {
    const { asked, fetchMock } = fakeRegister();
    const t = await setupApp({ INDUSTRY_LOOKUP: "true" }, fetchMock);
    const repo = t.s.finance(t.adminId);
    await repo.upsertAccount({ id: "chk", connectionId: null, provider: "enablebanking", externalId: "u", identity: null, name: "Käyttötili", iban: "FI2112345600000785", currency: "EUR", type: "checking" });
    await repo.upsertAccount({ id: "card", connectionId: null, provider: "enablebanking", externalId: "c", identity: null, name: "Luottokortti", iban: null, currency: "EUR", type: "credit_card" });
    const terminal = "483920 HELSINKI";
    await ingestTransactions(
      repo,
      "chk",
      [
        // the bank's rows carry payee accounts
        raw("2026-10-02", -900, "SAUMAUS NIEMINEN OY", { externalId: "e1", counterpartyIban: "FI4950009420028730" }),
        // a transfer to a person, twice: surname first, no payee account, a free message
        raw("2026-10-03", -40, "MEIKALAINEN MATTI", { externalId: "e2", description: "KIITOS" }),
        raw("2026-10-10", -40, "MEIKALAINEN MATTI", { externalId: "e3", description: "KIITOS" }),
        // MobilePay booked as a card purchase, the name cut at the field's length
        raw("2026-10-04", -15, "MOB.PAY*MATTI JUHANI MEIKAL", { externalId: "e4", description: terminal }),
        raw("2026-10-11", -15, "MOB.PAY*MATTI JUHANI MEIKAL", { externalId: "e5", description: terminal }),
        // a company behind the same prefix
        raw("2026-10-05", -25, "MOB.PAY*LANKAPUOTI RUUSU OY", { externalId: "e6", description: terminal }),
      ],
      "enablebanking",
    );
    await ingestTransactions(
      repo,
      "card",
      [raw("2026-10-06", -15, "MOB.PAY*LIISA MARJATTA VIRTA", { externalId: "k1", description: terminal }), raw("2026-10-07", -60, "VIRTANEN LIISA", { externalId: "k2", description: "KORTTIOSTO" })],
      "enablebanking",
    );
    await reprocess(repo, t.s.settings);
    await lookupIndustries(t.s, { pauseMs: 0 });
    // the company's name is also asked in a shorter form when the full one has no hit
    expect(asked.filter((name) => name.includes(" ") && /^(?:Lankapuoti|Saumaus)/.test(name)).sort()).toEqual(["Lankapuoti Ruusu", "Saumaus Nieminen Oy"]);
    expect(asked.filter((name) => /meik|matti|liisa|virta/i.test(name))).toEqual([]);
    expect(await t.s.db.all("SELECT merchant FROM merchant_industry_users WHERE merchant NOT IN ('Lankapuoti Ruusu', 'Saumaus Nieminen Oy')")).toEqual([]);
  });

  it("the door to the register refuses a person's name and the name of a way to pay without a request", async () => {
    const { asked, fetchMock } = fakeRegister();
    for (const name of ["Matti Meikäläinen", "Meikäläinen Matti", "M. Meikäläinen", "Osk. Meikäläinen", "Siirto", "Pikasiirto", "Tuntematon"]) {
      expect(await askRegister(fetchMock, name, new Set()), name).toEqual({ companies: [], complete: true });
    }
    expect(asked).toEqual([]);
    expect((await askRegister(fetchMock, "Pikku Puoti", new Set())).companies).toHaveLength(1);
    expect(asked).toEqual(["Pikku Puoti"]);
  });

  it("asks a company named after a person whole or not at all, and never a name behind PayPal or typed on an invoice", async () => {
    const { asked, fetchMock } = fakeRegister();
    const t = await setupApp({ INDUSTRY_LOOKUP: "true" }, fetchMock);
    const repo = t.s.finance(t.adminId);
    await repo.upsertAccount({ id: "chk", connectionId: null, provider: "enablebanking", externalId: "u", identity: null, name: "Käyttötili", iban: "FI2112345600000785", currency: "EUR", type: "checking" });
    await repo.upsertAccount({ id: "card", connectionId: null, provider: "enablebanking", externalId: "c", identity: null, name: "Luottokortti", iban: null, currency: "EUR", type: "credit_card" });
    const invoice = (n: number) => ({ externalId: `i${n}`, counterpartyIban: `FI495000942002874${n}`, reference: "1234561" });
    await ingestTransactions(
      repo,
      "chk",
      [
        // the register knows neither company: the full name gets no hit, and the name without its last word is a person's
        raw("2026-10-02", -900, "MATTI KIVISTÖ OY", { externalId: "e1", counterpartyIban: "FI4950009420028730" }),
        raw("2026-10-03", -300, "TMI MATTI ESIMERKKI", { externalId: "e2", counterpartyIban: "FI4950009420028731" }),
        // invoices: a private landlord gives a reference number too, and the payer typed the name
        raw("2026-10-04", -700, "MEIKÄLÄINEN", invoice(1)),
        raw("2026-10-05", -700, "M.MEIKÄLÄINEN", invoice(2)),
        raw("2026-10-06", -45, "ESIMERKIN TANSSIKERHO VILLE MEIKÄLÄINEN", invoice(3)),
        raw("2026-10-07", -45, "", { ...invoice(4), description: "TANSSIKERHO VILLE MEIKÄLÄINEN SYKSY" }),
        raw("2026-10-08", -45, "", { ...invoice(5), description: "SIIRTO" }),
      ],
      "enablebanking",
    );
    await ingestTransactions(
      repo,
      "card",
      [raw("2026-10-09", -20, "PAYPAL *MATTIMEIKALAINEN", { externalId: "k1", description: "35314369001 LUXEMBOURG" }), raw("2026-10-10", -20, "PAYPAL *LANKAPUOTI", { externalId: "k2", description: "35314369001 LUXEMBOURG" })],
      "enablebanking",
    );
    await reprocess(repo, t.s.settings);
    await lookupIndustries(t.s, { pauseMs: 0 });
    expect([...asked].sort()).toEqual(["Lankapuoti", "Matti Kivistö Oy", "Tmi Matti Esimerkki"]);
    expect((await t.s.db.all<{ merchant: string }>("SELECT merchant FROM merchant_industry_users ORDER BY merchant")).map((row) => row.merchant)).toEqual(["Lankapuoti", "Matti Kivistö Oy", "Tmi Matti Esimerkki"]);
  });

  it("asks about an invoice's payee whose name says it is a business: a payee account and a reference number", async () => {
    // the name tells no rule what is sold: the register's class does (the sale of motor vehicles)
    const { asked, fetchMock } = fakeRegister({ answer: (name) => (name === "Koneliike Esimerkki" ? Response.json({ totalResults: 1, companies: [company("4567890-4", ["Koneliike Esimerkki Oy"], "45110", "TOIMI3")] }) : undefined) });
    const { s, repo } = await withData(fetchMock);
    await ingestTransactions(
      repo,
      "chk",
      [
        raw("2026-09-07", -120, "KONELIIKE ESIMERKKI", { counterpartyIban: "FI4950009420028733", reference: "1234561" }),
        // a transfer with a message, and an invoice from a person
        raw("2026-09-08", -30, "LANKALIIKE ESIMERKKI", { counterpartyIban: "FI4950009420028734", description: "KIITOS" }),
        raw("2026-09-09", -400, "MEIKALAINEN MATTI", { counterpartyIban: "FI4950009420028735", reference: "1234574" }),
      ],
      "csv",
    );
    await reprocess(repo, s.settings);
    await lookupIndustries(s, { pauseMs: 0 });
    expect(asked).toContain("Koneliike Esimerkki");
    expect(asked.filter((name) => /lankaliike|meik|matti/i.test(name))).toEqual([]);
    // the answer is used on the invoice row: 120 € to a dealer is the car's upkeep
    expect((await repo.allTransactions()).find((t) => t.merchant === "Koneliike Esimerkki")).toMatchObject({ category: "car", categorySource: "industry" });
  });

  it("a user's own rule still wins over the register", async () => {
    const { fetchMock } = fakeRegister();
    const { s, repo } = await withData(fetchMock);
    await repo.addRule({ field: "merchant", pattern: "Pikku Puoti", category: "gifts_donations", priority: 10 });
    await lookupIndustries(s, { pauseMs: 0 });
    const row = (await repo.allTransactions()).find((t) => t.merchant === "Pikku Puoti");
    expect(row).toMatchObject({ category: "gifts_donations", categorySource: "rule" });
  });

  it("does nothing when an admin turned it off", async () => {
    const { asked, fetchMock } = fakeRegister();
    const { s } = await withData(fetchMock, { INDUSTRY_LOOKUP: "false" });
    expect(await lookupIndustries(s, { pauseMs: 0 })).toMatchObject({ skipped: "off", looked: 0 });
    expect(asked).toHaveLength(0);
  });

  it("stops after repeated register errors and does not retry the same day", async () => {
    const { asked, fetchMock } = fakeRegister({ fail: true });
    const { s, repo } = await withData(fetchMock);
    expect(await lookupIndustries(s, { pauseMs: 0 })).toMatchObject({ looked: 0, categorised: 0 });
    expect(asked).toHaveLength(2);
    expect(await lookupIndustries(s, { pauseMs: 0 })).toMatchObject({ looked: 0 });
    expect(asked).toHaveLength(2);
    // the register told nothing: what is not a person's is what it was
    expect((await repo.allTransactions()).filter((t) => t.category !== "p2p").every((t) => t.categorySource === "default")).toBe(true);
  });

  it("records which user asked about which name, people never", async () => {
    const { fetchMock } = fakeRegister();
    const { s, adminId } = await withData(fetchMock);
    await lookupIndustries(s, { pauseMs: 0 });
    const rows = await s.db.all<{ user_id: string; merchant: string }>("SELECT user_id, merchant FROM merchant_industry_users ORDER BY merchant");
    expect(rows).toEqual([
      { user_id: adminId, merchant: "Pikku Puoti" },
      { user_id: adminId, merchant: "Saumaus Nieminen Oy" },
    ]);
  });

  it("another user sees register categories only for names their own lookup asked about", async () => {
    const { asked, fetchMock } = fakeRegister();
    const { s, member } = await withData(fetchMock);
    await lookupIndustries(s, { pauseMs: 0 });
    const eero = await member("eero");
    expect(await s.finance(eero.id).industryCodes()).toEqual(new Map());

    // Eero buys at the same café. The answer is in the shared cache, but not his yet.
    const repo = s.finance(eero.id);
    await repo.upsertAccount({ id: "eero-chk", connectionId: null, provider: "csv", externalId: null, identity: null, name: "Eeron tili", iban: null, currency: "EUR", type: "checking" });
    await ingestTransactions(repo, "eero-chk", [raw("2026-09-05", -8, "PIKKU PUOTI", { description: "KORTTIOSTO" })], "csv");
    await reprocess(repo, s.settings);
    expect((await repo.allTransactions())[0]).toMatchObject({ merchant: "Pikku Puoti", categorySource: "default" });
    const list = await eero.call("GET", "/api/transactions");
    expect(list.body.items[0].industry).toBeUndefined();

    // his own lookup run asks about it: the cached answer applies without a new register request
    const r = await lookupIndustries(s, { pauseMs: 0 });
    expect(r).toMatchObject({ looked: 0 });
    expect(asked).toHaveLength(2);
    expect((await repo.allTransactions())[0]).toMatchObject({ category: "restaurants", categorySource: "industry" });
  });

  it("an update removes the stored answers of names that are no longer looked up, every user's by the same rule", async () => {
    const { fetchMock } = fakeRegister();
    const { s, adminId, member } = await withData(fetchMock);
    await lookupIndustries(s, { pauseMs: 0 });
    const eero = await member("eero");
    // as an earlier version stored them: a person's name and the name of a way to pay, each with the register's answer
    const none = { status: "none", businessId: null, companyName: null, code: null, codeSet: null, label: null, category: null } as const;
    for (const name of ["Liisa Virtanen", "MobilePay"]) await s.industry.save(name, none, NOW);
    await s.industry.recordRequests(adminId, ["Liisa Virtanen"]);
    await s.industry.recordRequests(eero.id, ["Liisa Virtanen", "MobilePay", "Pikku Puoti"]);

    await runUpgradeTasks(s, "0.8.7+refused");
    expect((await s.db.all<{ merchant: string }>("SELECT merchant FROM merchant_industry ORDER BY merchant")).map((r) => r.merchant)).toEqual(["Pikku Puoti", "Saumaus Nieminen Oy"]);
    const asked = (await s.db.all<{ user_id: string; merchant: string }>("SELECT user_id, merchant FROM merchant_industry_users")).map((r) => `${r.user_id} ${r.merchant}`);
    expect(asked.sort()).toEqual([`${adminId} Pikku Puoti`, `${adminId} Saumaus Nieminen Oy`, `${eero.id} Pikku Puoti`].sort());
    // the answers that stayed still give their category
    expect((await s.finance(adminId).allTransactions()).find((t) => t.merchant === "Pikku Puoti")).toMatchObject({ category: "restaurants", categorySource: "industry" });
  });

  it("trusts only an exact name when the register returned one page of a longer list", async () => {
    const page = (total: number) => Response.json({ totalResults: total, companies: [company("3456789-3", ["Lyhty Puoti Kallio Oy"], "56300")] });
    for (const [total, expected] of [
      [120, "default"],
      [1, "industry"],
    ] as const) {
      const { fetchMock } = fakeRegister({ answer: (name) => (name === "Lyhty Puoti" ? page(total) : undefined) });
      const { s, repo } = await withData(fetchMock);
      await ingestTransactions(repo, "chk", [raw("2026-09-06", -5, "LYHTY PUOTI", { description: "KORTTIOSTO" })], "csv");
      await reprocess(repo, s.settings);
      await lookupIndustries(s, { pauseMs: 0 });
      expect((await repo.allTransactions()).find((t) => t.merchant === "Lyhty Puoti")?.categorySource).toBe(expected);
    }
  });

  it("an unexpected error on one name is logged without the name and the run goes on", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const warnings = vi.spyOn(console, "warn").mockImplementation(() => {});
    // not a Response at all: fails outside the register client's own checks
    const { fetchMock } = fakeRegister({ answer: (name) => (name === "Saumaus Nieminen Oy" ? (null as unknown as Response) : undefined) });
    const { s, repo } = await withData(fetchMock);
    const r = await lookupIndustries(s, { pauseMs: 0 });
    expect(r).toMatchObject({ looked: 1, categorised: 1 });
    const byMerchant = new Map((await repo.allTransactions()).map((t) => [t.merchant, t]));
    expect(byMerchant.get("Pikku Puoti")).toMatchObject({ categorySource: "industry" });
    expect(byMerchant.get("Saumaus Nieminen Oy")).toMatchObject({ categorySource: "default" });
    expect(await s.db.first("SELECT status FROM merchant_industry WHERE merchant = ?", ["Saumaus Nieminen Oy"])).toEqual({ status: "error" });
    const logged = JSON.stringify([...errors.mock.calls, ...warnings.mock.calls]);
    expect(errors).toHaveBeenCalled();
    expect(logged).not.toMatch(/saumaus|nieminen/i);
  });

  it("applies the answers it got when the run fails late", async () => {
    const { fetchMock } = fakeRegister();
    const { s, repo } = await withData(fetchMock);
    // Saumaus (the larger total) goes first; storing the second answer fails
    const save = s.industry.save.bind(s.industry);
    let calls = 0;
    s.industry.save = async (...args) => {
      if (++calls === 2) throw new Error("disk full");
      return save(...args);
    };
    await expect(lookupIndustries(s, { pauseMs: 0 })).rejects.toThrow("disk full");
    const byMerchant = new Map((await repo.allTransactions()).map((t) => [t.merchant, t]));
    expect(byMerchant.get("Saumaus Nieminen Oy")).toMatchObject({ category: "home", categorySource: "industry" });
    // the lock is released for the next run
    s.industry.save = save;
    expect(await lookupIndustries(s, { pauseMs: 0 })).toMatchObject({ looked: 1, categorised: 1 });
  });
});

describe("lookups that start by themselves", () => {
  const HEADER = "Kirjauspäivä;Määrä;Maksaja;Maksunsaaja;Nimi;Otsikko;Viitenumero;Valuutta";
  const OWN = "FI12 1234 5600 0785 41";
  const card = (name: string) => `2026/09/01;-12,00;${OWN};;${name};KORTTIOSTO;;EUR`;
  const csv = (...rows: string[]) => [HEADER, ...rows].join("\n");
  const categoryOf = async (admin: { call(m: string, p: string): Promise<{ body: any }> }, merchant: string) =>
    (await admin.call("GET", `/api/transactions?merchant=${encodeURIComponent(merchant)}`)).body.items[0].categorySource;
  /** Time for a run that should not happen to show itself. */
  const settle = () => new Promise((r) => setTimeout(r, 100));

  it("a CSV import with new rows is looked up right away", async () => {
    const { asked, fetchMock } = fakeRegister();
    const { admin, s } = await setupApp({ INDUSTRY_LOOKUP: "true" }, fetchMock);
    const r = await seedCsv(s, admin, { content: csv(card("PIKKU PUOTI")), accountName: "Käyttötili" });
    expect(r.body.inserted).toBe(1);
    await waitFor(async () => (await categoryOf(admin, "Pikku Puoti")) === "industry");
    expect(asked).toEqual(["Pikku Puoti"]);
  });

  it("an import that brings nothing new, or with the setting off, asks nothing", async () => {
    const on = fakeRegister();
    const a = await setupApp({ INDUSTRY_LOOKUP: "true" }, on.fetchMock);
    const content = csv(card("PIKKU PUOTI"));
    const first = await seedCsv(a.s, a.admin, { content, accountName: "Käyttötili" });
    await waitFor(async () => (await categoryOf(a.admin, "Pikku Puoti")) === "industry");
    // forget the answer, so the name is due again
    await a.s.db.run("DELETE FROM merchant_industry_users");
    await a.s.db.run("DELETE FROM merchant_industry");
    const again = await seedCsv(a.s, a.admin, { content, accountId: first.body.accountId });
    expect(again.body.inserted).toBe(0);
    await settle();
    expect(on.asked).toEqual(["Pikku Puoti"]);

    const off = fakeRegister();
    const b = await setupApp({ INDUSTRY_LOOKUP: "false" }, off.fetchMock);
    await seedCsv(b.s, b.admin, { content, accountName: "Käyttötili" });
    await settle();
    expect(off.asked).toEqual([]);
  });

  it("keeps going until nothing is due, a batch at a time", async () => {
    const { asked, fetchMock } = fakeRegister();
    const { admin, s } = await setupApp({ INDUSTRY_LOOKUP: "true" }, fetchMock);
    const names = Array.from({ length: 31 }, (_, i) => `KAUPPA X${String.fromCharCode(65 + (i % 26))}${String.fromCharCode(65 + Math.floor(i / 26))} OY`);
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    try {
      await seedCsv(s, admin, { content: csv(...names.map(card)), accountName: "Käyttötili" });
      await vi.waitFor(async () => {
        await vi.advanceTimersByTimeAsync(1000);
        // a name with no hit is also asked in a shorter form; only the full names count here
        expect(new Set(asked.filter((n) => /^Kauppa X[a-z]{2}$/.test(n))).size).toBe(31);
      }, { timeout: 5000, interval: 5 });
    } finally {
      vi.useRealTimers();
    }
  });

  it("turning the setting on starts one, other changes and staying on do not", async () => {
    const { asked, fetchMock } = fakeRegister();
    const { admin, s, adminId } = await setupApp({ INDUSTRY_LOOKUP: "false" }, fetchMock);
    const repo = s.finance(adminId);
    await repo.upsertAccount({ id: "chk", connectionId: null, provider: "csv", externalId: null, identity: null, name: "Käyttötili", iban: "FI2112345600000785", currency: "EUR", type: "checking" });
    await ingestTransactions(repo, "chk", [raw("2026-09-01", -12, "PIKKU PUOTI", { description: "KORTTIOSTO" })], "csv");
    await reprocess(repo, s.settings);

    await admin.call("PUT", "/api/admin/instance", { historyDays: 365 });
    await settle();
    expect(asked).toEqual([]);

    expect((await admin.call("PUT", "/api/admin/instance", { industryLookup: true })).status).toBe(200);
    await waitFor(async () => (await categoryOf(admin, "Pikku Puoti")) === "industry");
    expect(asked).toEqual(["Pikku Puoti"]);

    // already on, so another save changes nothing
    await ingestTransactions(repo, "chk", [raw("2026-09-02", -9, "SAUMAUS NIEMINEN OY", { counterpartyIban: "FI4950009420028730" })], "csv");
    await admin.call("PUT", "/api/admin/instance", { industryLookup: true });
    await settle();
    expect(asked).toEqual(["Pikku Puoti"]);
  });

  /** A bank whose card has one purchase at a name the register knows, and the register, behind one fetch. */
  async function withBankAndRegister() {
    const bank = mockBank();
    const register = fakeRegister();
    const purchase = {
      entry_reference: "k1",
      transaction_amount: { currency: "EUR", amount: "12.00" },
      credit_debit_indicator: "DBIT",
      status: "BOOK",
      booking_date: "2026-10-05",
      remittance_information: ["PIKKU PUOTI"],
    };
    const fetchMock = ((input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith(PRH_SEARCH_URL)) return register.fetchMock(input);
      if (new URL(url).pathname === "/accounts/u-card/transactions") return Promise.resolve(Response.json({ transactions: [purchase] }));
      return bank.fetchMock(input, init);
    }) as typeof fetch;
    const pem = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    const t = await setupApp({ INDUSTRY_LOOKUP: "true", EB_APP_ID: randomUUID(), EB_PRIVATE_KEY: pem }, fetchMock);
    return { ...t, bank, asked: register.asked };
  }

  it("a fetch that brings new rows is followed by a lookup", async () => {
    const { admin, bank, asked } = await withBankAndRegister();
    await admin.call("POST", "/api/connections/start", {});
    await admin.call("POST", "/api/connections/complete", { url: `https://x.example/cb?code=abc&state=${bank.state}` });
    // the first fetch runs in the background after connecting; the lookup follows it
    await waitFor(async () => asked.includes("Pikku Puoti"));
  });

  it("the hourly tick looks up once, after its own fetch", async () => {
    const { s, adminId, asked } = await withBankAndRegister();
    const repo = s.finance(adminId);
    await repo.upsertConnection({ id: "sess-1", provider: "enablebanking", institution: "Nordea", country: "FI", status: "active", validUntil: "2027-04-06T00:00:00Z", createdAt: NOW.toISOString(), lastSyncedAt: null });
    await repo.upsertAccount({ id: "eb-card", connectionId: "sess-1", provider: "enablebanking", externalId: "u-card", identity: "h-card", name: "Nordea Gold", iban: null, currency: "EUR", type: "credit_card" });
    // 10:00 UTC is 13:00 in Helsinki
    await s.instance.save({ syncHours: [13] });

    const tick = await hourlyTick(s);
    expect(tick.synced?.[adminId]).toMatchObject({ status: "ok" });
    expect(tick.synced?.[adminId]?.inserted).toBeGreaterThan(0);
    expect(tick.lookup).toMatchObject({ looked: 1 });
    expect(asked).toEqual(["Pikku Puoti"]);
  });
});

describe("drainLookups", () => {
  async function manyNames(count: number) {
    const { asked, fetchMock } = fakeRegister();
    const t = await setupApp({ INDUSTRY_LOOKUP: "true" }, fetchMock);
    const repo = t.s.finance(t.adminId);
    await repo.upsertAccount({ id: "chk", connectionId: null, provider: "csv", externalId: null, identity: null, name: "Käyttötili", iban: "FI2112345600000785", currency: "EUR", type: "checking" });
    const rows = Array.from({ length: count }, (_, i) => raw("2026-09-01", -10 - i, `KAUPPA ${String.fromCharCode(65 + (i % 26))}${String.fromCharCode(65 + Math.floor(i / 26))} OY`));
    await ingestTransactions(repo, "chk", rows, "csv");
    await reprocess(repo, t.s.settings);
    return { ...t, asked };
  }

  it("works through every batch and stops at the cap", async () => {
    const { s } = await manyNames(70);
    const first = await drainLookups(s, { maxBatches: 2, pauseMs: 0 });
    expect(first.looked).toBe(60);
    const rest = await drainLookups(s, { pauseMs: 0 });
    expect(rest.looked).toBe(10);
  });

  it("reports a busy lock without looping", async () => {
    const { s, asked } = await manyNames(3);
    expect(await s.settings.tryLock("industry_lock", 60_000)).toBe(true);
    expect(await drainLookups(s, { pauseMs: 0 })).toMatchObject({ skipped: "busy", looked: 0 });
    expect(asked).toHaveLength(0);
  });
});

describe("register answer parsing", () => {
  it("keeps names in use and a valid industry, drops the rest", () => {
    expect(
      parseCompany({
        businessId: { value: "0112038-9" },
        names: [{ name: "Old Name Oy", endDate: "2001-01-01" }, { name: "New Name Oy" }, { name: 42 }],
        mainBusinessLine: { type: "56300", typeCodeSet: "TOIMI4", descriptions: [{ languageCode: "1", description: "Baarit ja kahvilat" }] },
      }),
    ).toEqual({ businessId: "0112038-9", names: ["New Name Oy"], industry: { code: "56300", codeSet: "TOL2025", label: "Baarit ja kahvilat" } });
    expect(parseCompany({ businessId: { value: "x" }, names: [{ name: "A" }] })).toBeNull();
    expect(parseCompany({ businessId: { value: "0112038-9" }, names: [{ name: "Gone", endDate: "2020-01-01" }] })).toBeNull();
    expect(parseCompany({ businessId: { value: "0112038-9" }, names: [{ name: "A Oy" }], mainBusinessLine: { type: "<script>", typeCodeSet: "TOIMI4" } })?.industry).toBeNull();
    expect(parseCompany(null)).toBeNull();
  });

  it("knows only the two code sets, not object properties", () => {
    for (const typeCodeSet of ["__proto__", "toString", "constructor", "hasOwnProperty"]) {
      const c = parseCompany({ businessId: { value: "0112038-9" }, names: [{ name: "A Oy" }], mainBusinessLine: { type: "56300", typeCodeSet } });
      expect(c?.industry).toBeNull();
    }
  });
});

describe("register client", () => {
  const ok = (body: unknown) => Response.json(body);
  const one = { totalResults: 1, companies: [company("0112038-9", ["A Oy"], "56300")] };

  it("refuses redirects instead of following them", async () => {
    let init: RequestInit | undefined;
    const fetchMock = (async (_url: string, i?: RequestInit) => {
      init = i;
      return new Response(null, { status: 302, headers: { location: "https://elsewhere.example/" } });
    }) as unknown as typeof fetch;
    await expect(searchCompanies(fetchMock, "A Oy")).rejects.toThrow(RegistryError);
    expect(init?.redirect).toBe("manual");
  });

  it("names the network cause when the register can not be reached, and only a plain code", async () => {
    const failing = (cause: unknown) => (async () => {
      throw new TypeError("fetch failed", { cause });
    }) as unknown as typeof fetch;
    await expect(searchCompanies(failing({ code: "ENOTFOUND" }), "A Oy")).rejects.toThrow("register not reachable: TypeError ENOTFOUND");
    await expect(searchCompanies(failing({ code: "Kahvila Ilo" }), "A Oy")).rejects.toThrow(/^register not reachable: TypeError$/);
  });

  it("says whether the answer holds every hit", async () => {
    expect(await searchCompanies((async () => ok(one)) as unknown as typeof fetch, "A Oy")).toMatchObject({ complete: true });
    expect(await searchCompanies((async () => ok({ ...one, totalResults: 75 })) as unknown as typeof fetch, "A Oy")).toMatchObject({ complete: false });
    expect(await searchCompanies((async () => ok({ companies: one.companies })) as unknown as typeof fetch, "A Oy")).toMatchObject({ complete: false });
    const many = Array.from({ length: 60 }, (_, i) => company(`${String(1000000 + i)}-1`, [`A ${i} Oy`], "56300"));
    expect((await searchCompanies((async () => ok({ totalResults: 60, companies: many })) as unknown as typeof fetch, "A")).companies).toHaveLength(60);
  });

  it("turns a failing or oversized body into a register error", async () => {
    const broken = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.error(new TypeError("connection reset"));
      },
    });
    await expect(searchCompanies((async () => new Response(broken, { status: 200 })) as unknown as typeof fetch, "A Oy")).rejects.toThrow(RegistryError);

    const declared = new Response("{}", { status: 200, headers: { "content-length": "5000000" } });
    await expect(searchCompanies((async () => declared) as unknown as typeof fetch, "A Oy")).rejects.toThrow("too large");

    let cancelled = false;
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array(256 * 1024).fill(32));
      },
      cancel() {
        cancelled = true;
      },
    });
    await expect(searchCompanies((async () => new Response(endless, { status: 200 })) as unknown as typeof fetch, "A Oy")).rejects.toThrow("too large");
    expect(cancelled).toBe(true);
  });
});
