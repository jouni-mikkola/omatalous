/**
 * GET /api/review: one queue of every question the app cannot settle itself, the most money first. Each item is
 * answered through its own source's route, and the answer does what the old card's did: the item goes, the count drops
 * by one, and the rows or marks move as before. Made-up names and sums; the test clock is 9.10.2026.
 */
import { notLoanMark, planSubject, type RawTransaction } from "@banking/core";
import { describe, expect, it } from "vitest";
import { reprocess } from "../src/services/enrich.ts";
import { ingestTransactions } from "../src/services/ingest.ts";
import { seedCsv } from "./csv-seed.ts";
import { setupApp } from "./helpers.ts";
import { fromAino, one, type R, world } from "./trace-world.ts";

const raw = (bookingDate: string, euros: number, counterparty: string, description: string): RawTransaction => ({
  externalId: null, bookingDate, valueDate: null, amountCents: Math.round(euros * 100), currency: "EUR", status: "booked",
  counterparty, counterpartyIban: null, description, reference: null, mcc: null,
});
const MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((m) => `2026-${String(m).padStart(2, "0")}`);
/** A lender's 250 €, a streaming service's 12,99 €, a shop nothing knows and a salary, every month. */
const ROWS = MONTHS.flatMap((m) => [
  raw(`${m}-05`, -250, "ESIMERKKIRAHOITUS OY", "LAINAN LYHENNYS"),
  raw(`${m}-08`, -12.99, "MAX", "KORTTIOSTO"),
  raw(`${m}-20`, -84.5, "KUMMAKAUPPA XYZ", "KORTTIOSTO"),
  raw(`${m}-10`, -42.1, "K-MARKET ESIMERKKI", "KORTTIOSTO"),
  raw(`${m}-15`, 3200, "ESIMERKKITYÖNANTAJA OY", "PALKKA"),
]);

type Item = { id: string; kind: string; cents: number; [field: string]: unknown };
type Caller = { call: (method: string, path: string, body?: unknown) => Promise<{ status: number; body: any }> };
const queue = async (c: Caller) => (await c.call("GET", "/api/review")).body.items as Item[];
const ids = async (c: Caller) => (await queue(c)).map((i) => i.id);

async function household() {
  const t = await setupApp();
  const repo = t.s.finance(t.adminId);
  await repo.upsertAccount({ id: "chk", connectionId: null, provider: "csv", externalId: null, identity: null, name: "Käyttötili", iban: null, currency: "EUR", type: "checking" });
  await ingestTransactions(repo, "chk", ROWS, "csv");
  await reprocess(repo, t.s.settings);
  return t;
}

describe("the review queue", () => {
  it("gathers the sources, the most money a year first, and a member with no rows has nothing", async () => {
    const t = await household();
    const res = await t.admin.call("GET", "/api/review");
    expect(res.status).toBe(200);
    const items = res.body.items as Item[];
    expect(items.map((i) => i.kind)).toEqual(["loan", "payee_out", "subscription", "payee_out", "mortgage"]);
    expect(items.map((i) => i.cents)).toEqual([...items.map((i) => i.cents)].sort((a, b) => b - a));
    expect(items[0]).toMatchObject({ kind: "loan", payee: "Esimerkkirahoitus", paymentCents: 25000, cents: 300000, placed: true, guess: "consumer" });
    expect(items[2]).toMatchObject({ kind: "subscription", merchant: "Max", monthlyCents: 1299, subject: "series:out:chk:Max#1299" });
    expect(Object.keys(res.body)).toEqual(["items"]);
    // a payee's quick picks are the household's own most used categories on its side, never Muut menot
    const shop = items.find((i) => i.id === "payee_out:Kummakauppa Xyz")!;
    expect(shop.picks).toContain("groceries");
    expect(shop.picks).not.toContain("other");
    expect((shop.picks as string[]).length).toBeLessThanOrEqual(4);
    const maija = await t.member("maija", "Maija");
    expect(await queue(maija)).toEqual([]);
  });

  it("the count is the length of the queue, for the mark in the header, and a member with no rows has none", async () => {
    const t = await household();
    const res = await t.admin.call("GET", "/api/review/count");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ count: (await queue(t.admin)).length });
    expect(res.body.count).toBeGreaterThan(0);
    const maija = await t.member("maija", "Maija");
    expect((await maija.call("GET", "/api/review/count")).body).toEqual({ count: 0 });
  });

  it("each item sends its own rows, newest first: a payee's the question counts, a series' its own and no other of the payee", async () => {
    const t = await household();
    const items = await queue(t.admin);
    type Row = { date: string; cents: number; name: string; text: string };
    const rowsOf = (id: string) => items.find((i) => i.id === id) as Item & { rows: Row[]; rowCount: number; count?: number };
    const shop = rowsOf("payee_out:Kummakauppa Xyz");
    expect(shop.rowCount).toBe(shop.count);
    expect(new Set(shop.rows.map((r) => [r.name, r.cents, r.text].join("|")))).toEqual(new Set(["Kummakauppa Xyz|-8450|KORTTIOSTO"]));
    expect(shop.rows.map((r) => r.date)).toEqual([...shop.rows.map((r) => r.date)].sort().reverse());
    const [loan] = items.filter((i) => i.kind === "loan") as (Item & { rows: Row[]; rowCount: number })[];
    expect(loan!.rowCount).toBe(MONTHS.length);
    expect(new Set(loan!.rows.map((r) => r.cents))).toEqual(new Set([-25000]));

    // a second, smaller series of the same payee is no row of the first
    const u = await setupApp();
    const repo = u.s.finance(u.adminId);
    await repo.upsertAccount({ id: "chk", connectionId: null, provider: "csv", externalId: null, identity: null, name: "Käyttötili", iban: null, currency: "EUR", type: "checking" });
    await ingestTransactions(repo, "chk", MONTHS.flatMap((m) => [raw(`${m}-08`, -12.99, "MAX", "KORTTIOSTO"), raw(`${m}-18`, -0.99, "MAX", "KORTTIOSTO")]), "csv");
    await reprocess(repo, u.s.settings);
    const subs = (await queue(u.admin)).filter((i) => i.kind === "subscription") as (Item & { monthlyCents: number; rows: Row[] })[];
    expect(subs.length).toBeGreaterThan(0);
    for (const sub of subs) expect(new Set(sub.rows.map((r) => r.cents)), sub.id).toEqual(new Set([-sub.monthlyCents]));
  });

  it("a payee's category is the rule the old card saved: its rows move and the item goes", async () => {
    const t = await household();
    const before = await ids(t.admin);
    expect((await t.admin.call("POST", "/api/rules", { field: "merchant_exact", pattern: "Kummakauppa Xyz", category: "groceries" })).status).toBe(200);
    expect(await ids(t.admin)).toEqual(before.filter((id) => id !== "payee_out:Kummakauppa Xyz"));
    const shop = (await t.s.finance(t.adminId).allTransactions()).filter((r) => r.merchant === "Kummakauppa Xyz");
    expect(new Set(shop.map((r) => r.category))).toEqual(new Set(["groceries"]));
    // "Älä kysy tästä enää" is the old Ohita's mark: the payee keeps its money and is not asked again
    expect((await t.admin.call("PUT", "/api/marks", { subject: "question:payee:Max", mark: "dismissed" })).status).toBe(200);
    expect(await ids(t.admin)).not.toContain("payee_out:Max");
  });

  it("a payee carries the guess its evidence passes the gate for, first among the picks; the answer is the household's rule", async () => {
    const t = await household();
    const repo = t.s.finance(t.adminId);
    await ingestTransactions(repo, "chk", MONTHS.flatMap((m) => [raw(`${m}-12`, -38, "HAPPY DOG TRIMMI EAST", "KORTTIOSTO"), raw(`${m}-22`, -41, "HAPPY DOG TRIMMI WEST", "KORTTIOSTO"), raw(`${m}-25`, -29.9, "ESIMERKKI TELE OY", "PUHELINLIITTYMA")]), "csv");
    await reprocess(repo, t.s.settings);
    expect((await t.admin.call("POST", "/api/rules", { field: "merchant_exact", pattern: "Happy Dog Trimmi East", category: "pets" })).status).toBe(200);
    const items = await queue(t.admin);
    const west = items.find((i) => i.id === "payee_out:Happy Dog Trimmi West")!;
    expect(west.guess).toEqual({ category: "pets", reason: "Sama kategoria kuin Happy Dog Trimmi East" });
    expect((west.picks as string[])[0]).toBe("pets");
    expect((west.picks as string[]).length).toBeLessThanOrEqual(4);
    // a phone connection is offered the phone category first, not the household's groceries
    const tele = items.find((i) => i.id === "payee_out:Esimerkki Tele Oy")!;
    expect(tele.guess).toEqual({ category: "telecom", reason: "Maksun tekstin perusteella" });
    expect((tele.picks as string[])[0]).toBe("telecom");
    // no evidence: the household's most used, no guess
    expect(items.find((i) => i.id === "payee_out:Kummakauppa Xyz")!.guess).toBeUndefined();
    // nothing was filed by the guess; the answer goes through the rule as any pick
    expect(new Set((await repo.allTransactions()).filter((r) => r.merchant === "Happy Dog Trimmi West").map((r) => r.category))).toEqual(new Set(["other"]));
    expect((await t.admin.call("POST", "/api/rules", { field: "merchant_exact", pattern: "Happy Dog Trimmi West", category: "pets" })).status).toBe(200);
    expect(await ids(t.admin)).not.toContain("payee_out:Happy Dog Trimmi West");
  });

  it("a loan's rows are the bank's whole charges, as its monthly figure is, also on an account the viewer counts at a part", async () => {
    const t = await household();
    const eero = await t.member("eero");
    // the account is used 60:40: the own view counts each row at 60 %, the proposal the bank's whole payment
    expect((await t.admin.call("PUT", "/api/accounts/chk/use", { users: [{ userId: t.adminId, weight: 60 }, { userId: eero.id, weight: 40 }] })).status).toBe(200);
    const [loan] = (await queue(t.admin)).filter((i) => i.kind === "loan") as (Item & { paymentCents: number; rows: { cents: number }[] })[];
    expect(loan!.paymentCents).toBe(25000);
    expect(new Set(loan!.rows.map((r) => r.cents))).toEqual(new Set([-25000]));
  });

  it("asks whether there is a home loan while Asuminen has charges and no loan; Ei asuntolainaa and a saved mortgage take it away", async () => {
    // a housing company's charge and a salary: no loan, no rent
    const owner = async () => {
      const t = await setupApp();
      const repo = t.s.finance(t.adminId);
      await repo.upsertAccount({ id: "chk", connectionId: null, provider: "csv", externalId: null, identity: null, name: "Käyttötili", iban: null, currency: "EUR", type: "checking" });
      await ingestTransactions(repo, "chk", MONTHS.flatMap((m) => [raw(`${m}-03`, -310, "AS OY ESIMERKKITALO", "HOITOVASTIKE"), raw(`${m}-15`, 3200, "ESIMERKKITYÖNANTAJA OY", "PALKKA")]), "csv");
      await reprocess(repo, t.s.settings);
      return t;
    };
    const t = await owner();
    const [item] = (await queue(t.admin)).filter((i) => i.kind === "mortgage");
    expect(item).toMatchObject({ id: "mortgage", cents: 0 });
    // the household answered on the first page before the question moved: the same mark, the same route
    expect((await t.admin.call("PUT", "/api/marks", { subject: "question:mortgage", mark: "dismissed" })).status).toBe(200);
    expect(await ids(t.admin)).not.toContain("mortgage");
    // the housing report agrees
    expect((await t.admin.call("GET", "/api/reports?reports=housing")).body.housing?.ask ?? false).toBe(false);

    const u = await owner();
    expect(await ids(u.admin)).toContain("mortgage");
    const saved = await u.admin.call("POST", "/api/loans", { name: "Asuntolaina", kind: "mortgage", balanceCents: 15_000_000, balanceDate: "2026-10-01" });
    expect(saved.status).toBe(200);
    expect(await ids(u.admin)).not.toContain("mortgage");

    // a tenant is not asked
    const v = await household();
    const repo = v.s.finance(v.adminId);
    await ingestTransactions(repo, "chk", MONTHS.map((m) => raw(`${m}-02`, -900, "VUOKRANANTAJA OY", "VUOKRA")), "csv");
    await reprocess(repo, v.s.settings);
    expect(await ids(v.admin)).not.toContain("mortgage");
  });

  it("a loan goes with Ei ole laina, and with a loan saved for its series", async () => {
    const t = await household();
    const [loan] = (await queue(t.admin)).filter((i) => i.kind === "loan");
    expect((await t.admin.call("PUT", "/api/marks", notLoanMark({ key: loan!.key as string }))).status).toBe(200);
    expect(await ids(t.admin)).not.toContain(loan!.id);
    // the proposals of Asetukset > Lainat read the same: nothing left there either
    expect((await t.admin.call("GET", "/api/loans/proposals")).body.proposals).toEqual([]);

    const u = await household();
    const [other] = (await queue(u.admin)).filter((i) => i.kind === "loan");
    const saved = await u.admin.call("POST", "/api/loans", { name: "Kulutusluotto", kind: "consumer", balanceCents: 900_000, balanceDate: "2026-10-01", paymentCents: 25000, intervalMonths: 1, seriesKey: other!.key });
    expect(saved.status).toBe(200);
    expect(await ids(u.admin)).not.toContain(other!.id);
  });

  it("an instalment plan is asked its end, and payments left or En tiedä is the mark the old card stored", async () => {
    const t = await setupApp();
    const repo = t.s.finance(t.adminId);
    await repo.upsertAccount({ id: "chk", connectionId: null, provider: "csv", externalId: null, identity: null, name: "Käyttötili", iban: null, currency: "EUR", type: "checking" });
    const plan = ["2026-06-12", "2026-07-12", "2026-08-12", "2026-09-12"].map((d) => raw(d, -49.9, "KLARNA BANK AB", "LASKU"));
    await ingestTransactions(repo, "chk", plan, "csv");
    await reprocess(repo, t.s.settings);
    const items = await queue(t.admin);
    const [asked] = items.filter((i) => i.kind === "plan");
    expect(asked).toMatchObject({ payee: expect.stringMatching(/Klarna/i), paymentCents: 4990, cents: 12 * 4990, lastDate: "2026-09-12" });
    // a plan is asked as a plan, never as a loan of its own
    expect(items.filter((i) => i.kind === "loan")).toEqual([]);
    expect((await t.admin.call("PUT", "/api/marks", { subject: planSubject("2027-03", asked!.key as string), mark: "in_use" })).status).toBe(200);
    expect(await ids(t.admin)).not.toContain(asked!.id);
    expect((await t.admin.call("PUT", "/api/marks", { subject: planSubject("2027-03", asked!.key as string), mark: null })).status).toBe(200);
    expect(await ids(t.admin)).toContain(asked!.id);
    expect((await t.admin.call("PUT", "/api/marks", { subject: planSubject(null, asked!.key as string), mark: "in_use" })).status).toBe(200);
    expect(await ids(t.admin)).not.toContain(asked!.id);
  });

  it("a subscription's Käytössä is the mark Laskut reads, and the item goes", async () => {
    const t = await household();
    const [sub] = (await queue(t.admin)).filter((i) => i.kind === "subscription");
    const before = (await queue(t.admin)).length;
    expect((await t.admin.call("PUT", "/api/marks", { subject: sub!.subject, mark: "in_use" })).status).toBe(200);
    expect(await queue(t.admin)).toHaveLength(before - 1);
    const marks = (await t.admin.call("GET", "/api/recurring")).body.marks as { subject: string; mark: string }[];
    expect(marks).toContainEqual(expect.objectContaining({ subject: sub!.subject, mark: "in_use" }));
  });

  it("a price rise and a new regular charge are each one item, none twice, and the answer takes it away", async () => {
    const t = await setupApp();
    const repo = t.s.finance(t.adminId);
    await repo.upsertAccount({ id: "chk", connectionId: null, provider: "csv", externalId: null, identity: null, name: "Käyttötili", iban: null, currency: "EUR", type: "checking" });
    await ingestTransactions(repo, "chk", [
      ...MONTHS.map((m) => raw(`${m}-15`, 3200, "ESIMERKKITYÖNANTAJA OY", "PALKKA")),
      // two charges that got dearer in July: a gym, and a small streaming service that is a quiet subscription too
      ...MONTHS.map((m) => raw(`${m}-04`, m < "2026-07" ? -100 : -110, "KUNTOSALI ESIMERKKI", "KORTTIOSTO")),
      ...MONTHS.map((m) => raw(`${m}-08`, m < "2026-07" ? -11.99 : -12.99, "MAX", "KORTTIOSTO")),
      // a charge that began in August
      ...["2026-08-01", "2026-09-01", "2026-10-01"].map((day) => raw(day, -19.9, "LEHTITALO ESIMERKKI", "KORTTIOSTO")),
    ], "csv");
    await reprocess(repo, t.s.settings);
    const subs = async () => (await queue(t.admin)).filter((i) => i.kind === "subscription");
    const first = await subs();
    expect(first.map((i) => [i.merchant, i.reason]).sort()).toEqual([["Kuntosali Esimerkki", "price"], ["Lehtitalo Esimerkki", "new"], ["Max", "price"]]);
    // one item a series, and no id twice in the whole queue
    expect(new Set(first.map((i) => i.seriesId)).size).toBe(first.length);
    const all = await ids(t.admin);
    expect(new Set(all).size).toBe(all.length);
    const of = (merchant: string) => first.find((i) => i.merchant === merchant)!;
    // a rise alone is worth what it adds to a year, a new charge its year
    expect(of("Kuntosali Esimerkki")).toMatchObject({ price: { fromCents: 10000, toCents: 11000, date: "2026-07-04" }, cents: 12000, monthlyCents: 11000 });
    expect(of("Lehtitalo Esimerkki")).toMatchObject({ since: "2026-08-01", cents: 23880 });
    expect(of("Lehtitalo Esimerkki").price).toBeUndefined();
    expect(of("Max")).toMatchObject({ price: { fromCents: 1199, toCents: 1299 }, cents: 15588 });
    // Käytössä or Lopetettu answers a finding as it answers a subscription
    expect((await t.admin.call("PUT", "/api/marks", { subject: of("Kuntosali Esimerkki").subject, mark: "in_use" })).status).toBe(200);
    expect((await t.admin.call("PUT", "/api/marks", { subject: of("Lehtitalo Esimerkki").subject, mark: "cancelled" })).status).toBe(200);
    expect((await subs()).map((i) => i.merchant)).toEqual(["Max"]);
  });

  it("no number for the removed tips page is asked, also of a household that was asked one, and a stored one stays", async () => {
    const t = await household();
    const repo = t.s.finance(t.adminId);
    // an electricity bill each month: the queue asked this household when its contract ends
    await ingestTransactions(repo, "chk", MONTHS.map((m) => raw(`${m}-12`, -64.3, "HELEN OY", "SÄHKÖLASKU")), "csv");
    await reprocess(repo, t.s.settings);
    expect((await queue(t.admin)).filter((i) => i.kind === "input")).toEqual([]);
    expect((await ids(t.admin)).filter((id) => id.startsWith("input:"))).toEqual([]);
    // a number typed in before is kept, and reading the queue takes none away
    await t.s.db.run("INSERT INTO optimise_inputs (user_id, key, value, as_of) VALUES (?, 'electricity_contract_end', '\"2027-03-31\"', '2026-10-01')", [t.adminId]);
    expect((await queue(t.admin)).filter((i) => i.kind === "input")).toEqual([]);
    expect(await t.s.db.first("SELECT key FROM optimise_inputs WHERE user_id = ?", [t.adminId])).toEqual({ key: "electricity_contract_end" });
  });

  it("a payer's role moves the member's rows as on the old card", async () => {
    const t = await setupApp();
    const csv = ["Kirjauspäivä;Määrä;Nimi;Otsikko", ...["2026/07/03", "2026/08/03", "2026/09/03"].map((d) => `${d};300,00;Esimerkki Ville;Siirto`)].join("\n");
    await seedCsv(t.s, t.admin, { content: csv, accountName: "Käyttötili", accountType: "checking" });
    const [payer] = (await queue(t.admin)).filter((i) => i.kind === "payer");
    expect(payer).toMatchObject({ key: "name:ESIMERKKI VILLE", cents: 90000, count: 3 });
    expect((await t.admin.call("PUT", "/api/payer-roles", { key: payer!.key, role: "sales" })).body).toEqual({ ok: true });
    expect(await ids(t.admin)).not.toContain(payer!.id);
    const incomes = (await t.s.finance(t.adminId).allTransactions()).filter((r) => r.amountCents > 0).map((r) => r.category);
    expect(incomes).toEqual(["sales", "sales", "sales"]);
  });

  it("a shared account's question is asked of the member who linked it, with no guess, and an answer takes it away", async () => {
    const rows: R[] = [fromAino("2026-07-01", 1150), ["2026-07-03", -1104.37, "ESIMERKKI PANKKI"], ["2026-09-03", -1104.37, "ESIMERKKI PANKKI"]];
    const w = await world(one(rows, 312045, {
      extra: async (x) => {
        expect(await x.s.household.share(x.aino, "pool-a", x.ville)).toBe(true);
        await x.as(x.aino).call("PUT", "/api/accounts/pool-a/split", { mode: "source" });
      },
    }));
    const items = (await queue(w.as(w.aino))).filter((i) => i.kind === "split");
    expect(items).toEqual([expect.objectContaining({ accountId: "pool-a", question: "opening", key: "o", label: "2026-07-01" })]);
    expect(items[0]).not.toHaveProperty("guess");
    expect((await queue(w.as(w.ville))).filter((i) => i.kind === "split")).toEqual([]);
    expect((await w.as(w.aino).call("PUT", "/api/accounts/pool-a/answers", { kind: "opening", key: "o", owner: `u:${w.aino}` })).body).toEqual({ ok: true });
    expect((await queue(w.as(w.aino))).filter((i) => i.kind === "split")).toEqual([]);
  });
});

describe("what is wrong, in the same queue", () => {
  /** A bank account on a consent with six days left, a power bill that did not come in October, a row with no name, and balances the rows miss by 10 €. */
  async function troubled() {
    const t = await setupApp();
    const repo = t.s.finance(t.adminId);
    await repo.upsertConnection({ id: "sess-1", provider: "enablebanking", institution: "Esimerkkipankki", country: "FI", status: "active", validUntil: "2026-10-15T12:00:00Z", createdAt: "2026-04-18T12:00:00Z", lastSyncedAt: null });
    await repo.upsertAccount({ id: "chk", connectionId: "sess-1", provider: "enablebanking", externalId: "ext-chk", identity: "idn-chk", name: "Käyttötili", iban: null, currency: "EUR", type: "checking" });
    const rows = [
      ...MONTHS.flatMap((m) => [raw(`${m}-01`, -64.2, "ESIMERKKISÄHKÖ OY", "SÄHKÖLASKU"), raw(`${m}-15`, 3200, "ESIMERKKITYÖNANTAJA OY", "PALKKA")]),
      { ...raw("2026-10-03", -37.5, "", ""), counterparty: null, description: null },
    ];
    await ingestTransactions(repo, "chk", rows, "enablebanking");
    await reprocess(repo, t.s.settings);
    await repo.recordHistory("chk", "2026-01-01", "default", "2026-09-01T06:00:00.000Z");
    // the bank's balance fell 47,50 € over the days the one row of 37,50 € is in
    await repo.recordBalances("idn-chk", "2026-10-01", "2026-10-01T06:00:00.000Z", [{ cents: 500_000, type: "CLBD", referenceDay: "2026-09-30" }]);
    await repo.recordBalances("idn-chk", "2026-10-08", "2026-10-08T06:00:00.000Z", [{ cents: 495_250, type: "CLBD", referenceDay: "2026-10-07" }]);
    return { t, yearCents: rows.reduce((sum, r) => sum + Math.abs(r.amountCents), 0) };
  }
  const wrong = async (c: Caller) => (await queue(c)).filter((i) => ["balance", "consent", "bill", "row"].includes(i.kind));

  it("a balance that differs, an ending consent, a missed bill and a row with no name are one item each with its sum, beside the housing question", async () => {
    const { t, yearCents } = await troubled();
    const items = await wrong(t.admin);
    expect(items.map((i) => i.kind).sort()).toEqual(["balance", "bill", "consent", "row"]);
    const of = (kind: string) => items.find((i) => i.kind === kind)!;
    expect(of("balance")).toMatchObject({ id: "balance:chk", cents: 1000, accountId: "chk", accountName: "Käyttötili", fromDay: "2026-10-01", toDay: "2026-10-07", bankCents: -4750, rowsCents: -3750 });
    expect(of("consent")).toMatchObject({ id: "consent:sess-1", cents: yearCents, connection: "sess-1", institution: "Esimerkkipankki", daysLeft: 6, accounts: ["Käyttötili"] });
    expect(of("bill")).toMatchObject({ cents: 6420, dueDate: "2026-10-01", subject: "series:out:chk:Esimerkkisähkö#6420" });
    expect(of("row")).toMatchObject({ cents: 3750, side: "out", date: "2026-10-03", rowCount: 1 });
    expect((of("row").rows as { cents: number }[])[0]!.cents).toBe(-3750);
    // today's questions stay: the queue is still ordered by the money, and the tab's count is of all of it
    const all = await queue(t.admin);
    expect(all.map((i) => i.cents)).toEqual([...all.map((i) => i.cents)].sort((a, b) => b - a));
    expect((await t.admin.call("GET", "/api/review/count")).body).toEqual({ count: all.length });
  });

  it("each goes when its cause does: a category for the row, Lopetettu for the bill, a new consent, a balance that adds up", async () => {
    const { t } = await troubled();
    const repo = t.s.finance(t.adminId);
    const kinds = async () => (await wrong(t.admin)).map((i) => i.kind).sort();
    const items = await wrong(t.admin);
    const row = items.find((i) => i.kind === "row")!;
    expect((await t.admin.call("PATCH", `/api/transactions/${row.rowId}`, { category: "groceries" })).status).toBe(200);
    expect(await kinds()).toEqual(["balance", "bill", "consent"]);
    expect((await t.admin.call("PUT", "/api/marks", { subject: items.find((i) => i.kind === "bill")!.subject, mark: "cancelled" })).status).toBe(200);
    expect(await kinds()).toEqual(["balance", "consent"]);
    await repo.upsertConnection({ ...(await repo.listConnections())[0]!, validUntil: "2027-04-06T12:00:00Z" });
    expect(await kinds()).toEqual(["balance"]);
    await repo.recordBalances("idn-chk", "2026-10-09", "2026-10-09T06:00:00.000Z", [{ cents: 494_250, type: "CLBD", referenceDay: "2026-10-08" }]);
    await ingestTransactions(repo, "chk", [raw("2026-10-08", -10, "K-MARKET ESIMERKKI", "KORTTIOSTO")], "enablebanking");
    expect(await kinds()).toEqual([]);
  });

  it("money in with no name is a row's item, but not when a payer's question asks of it or its payer has a role", async () => {
    const t = await setupApp();
    const repo = t.s.finance(t.adminId);
    await repo.upsertAccount({ id: "chk", connectionId: null, provider: "csv", externalId: null, identity: null, name: "Käyttötili", iban: null, currency: "EUR", type: "checking" });
    const unnamed = (day: string, euros: number, iban: string | null) => ({ ...raw(day, euros, "", ""), counterparty: null, counterpartyIban: iban, description: null });
    // one with nothing to know its payer by, one whose payer has an IBAN
    await ingestTransactions(repo, "chk", [unnamed("2026-10-02", 120, null), unnamed("2026-10-03", 150, "FI2112345600000785")], "csv");
    await reprocess(repo, t.s.settings);
    // the IBAN's row is the payer's question alone: the same money is not asked twice
    expect(await wrong(t.admin)).toEqual([expect.objectContaining({ kind: "row", side: "in", cents: 12000, date: "2026-10-02", rowCount: 1 })]);
    expect(await ids(t.admin)).toContain("payer:iban:FI2112345600000785");
    // the role answers its row: neither the payer's question nor a row's item is left of it
    expect((await t.admin.call("PUT", "/api/payer-roles", { key: "iban:FI2112345600000785", role: "sales" })).body).toEqual({ ok: true });
    expect((await queue(t.admin)).filter((i) => i.kind !== "mortgage").map((i) => i.kind)).toEqual(["row"]);
  });

  it("the housing question is kept, beside a missed bill", async () => {
    const t = await setupApp();
    const repo = t.s.finance(t.adminId);
    await repo.upsertAccount({ id: "chk", connectionId: null, provider: "csv", externalId: null, identity: null, name: "Käyttötili", iban: null, currency: "EUR", type: "checking" });
    await ingestTransactions(repo, "chk", MONTHS.flatMap((m) => [raw(`${m}-03`, -310, "AS OY ESIMERKKITALO", "HOITOVASTIKE"), raw(`${m}-15`, 3200, "ESIMERKKITYÖNANTAJA OY", "PALKKA")]), "csv");
    await reprocess(repo, t.s.settings);
    expect(await ids(t.admin)).toContain("mortgage");
    // October's charge is six days late, so the housing company is a missed bill beside the question
    expect(await wrong(t.admin)).toEqual([expect.objectContaining({ kind: "bill", merchant: "As Oy Esimerkkitalo", cents: 31000, dueDate: "2026-10-03" })]);
  });
});
