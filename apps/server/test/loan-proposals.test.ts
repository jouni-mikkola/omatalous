/**
 * GET /api/loans/proposals: the loans the bank rows show and the household has not answered. A proposal goes when a loan
 * with its series key is saved and when "Ei laina" is marked, at once and with no data version moving; another user's
 * rows give nothing.
 */
import { notLoanMark, type RawTransaction } from "@banking/core";
import { describe, expect, it } from "vitest";
import { reprocess } from "../src/services/enrich.ts";
import { ingestTransactions } from "../src/services/ingest.ts";
import { setupApp } from "./helpers.ts";

const raw = (bookingDate: string, euros: number, counterparty: string, description: string): RawTransaction => ({
  externalId: null, bookingDate, valueDate: null, amountCents: Math.round(euros * 100), currency: "EUR", status: "booked",
  counterparty, counterpartyIban: null, description, reference: null, mcc: null,
});

/** A made-up lender debiting 250 € on the 5th of every month from April to October 2026 (the test clock is 9.10.), and a salary. */
const rows = [4, 5, 6, 7, 8, 9, 10].flatMap((month) => {
  const m = String(month).padStart(2, "0");
  return [raw(`2026-${m}-05`, -250, "ESIMERKKIRAHOITUS OY", "LAINAN LYHENNYS"), raw(`2026-${m}-15`, 3200, "ESIMERKKITYÖNANTAJA OY", "PALKKA")];
});

async function withLoanRows(loanRows = rows) {
  const t = await setupApp();
  const user = async (id: string) => {
    const repo = t.s.finance(id);
    await repo.upsertAccount({ id: `chk-${id}`, connectionId: null, provider: "csv", externalId: null, identity: null, name: "Käyttötili", iban: null, currency: "EUR", type: "checking" });
    await ingestTransactions(repo, `chk-${id}`, loanRows, "csv");
    await reprocess(repo, t.s.settings);
  };
  await user(t.adminId);
  const proposals = async (c: { call: typeof t.admin.call } = t.admin) => (await c.call("GET", "/api/loans/proposals")).body.proposals as { key: string; [field: string]: unknown }[];
  return { ...t, user, proposals };
}

describe("loan proposals", () => {
  it("answers what the page needs of a series, and no row, account or reference", async () => {
    const t = await withLoanRows();
    const res = await t.admin.call("GET", "/api/loans/proposals");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      proposals: [
        {
          key: expect.stringMatching(/^out:chk-.+:.+#25000$/),
          payee: "Esimerkkirahoitus",
          paymentCents: 25000,
          months: 7,
          firstDate: "2026-04-05",
          lastDate: "2026-10-05",
          kind: "consumer",
        },
      ],
    });
    // nothing of the series leaves the server but those seven fields
    expect(Object.keys(res.body.proposals[0]).sort()).toEqual(["firstDate", "key", "kind", "lastDate", "months", "payee", "paymentCents"]);
  });

  it("gives nothing without rows, and to a signed-out request", async () => {
    const t = await setupApp();
    expect((await t.admin.call("GET", "/api/loans/proposals")).body).toEqual({ proposals: [] });
    const anonymous = t.client();
    expect((await anonymous.call("GET", "/api/loans/proposals")).status).toBe(401);
  });

  it("goes when a loan with its series key is saved, and comes back when the loan is removed", async () => {
    const t = await withLoanRows();
    const [proposal] = await t.proposals();
    const version = await t.s.settings.dataVersionOf([t.adminId]);
    const saved = await t.admin.call("POST", "/api/loans", { name: "Kulutusluotto", kind: "consumer", balanceCents: 900_000, balanceDate: "2026-10-01", paymentCents: 25000, intervalMonths: 1, seriesKey: proposal!.key });
    expect(saved.status).toBe(200);
    expect(await t.proposals()).toEqual([]);
    // a saved loan is read per request: no data version moved
    expect(await t.s.settings.dataVersionOf([t.adminId])).toBe(version);
    expect((await t.admin.call("DELETE", `/api/loans/${saved.body.loan.id}`)).status).toBe(200);
    expect((await t.proposals()).map((p) => p.key)).toEqual([proposal!.key]);
  });

  it("goes when Ei laina is marked, at once, and comes back when the mark is taken away", async () => {
    const t = await withLoanRows();
    const [proposal] = await t.proposals();
    const version = await t.s.settings.dataVersionOf([t.adminId]);
    const { subject, mark } = notLoanMark({ key: proposal!.key });
    expect((await t.admin.call("PUT", "/api/marks", { subject, mark })).status).toBe(200);
    expect(await t.proposals()).toEqual([]);
    expect(await t.s.settings.dataVersionOf([t.adminId])).toBe(version);
    await t.admin.call("PUT", "/api/marks", { subject, mark: null });
    expect((await t.proposals()).map((p) => p.key)).toEqual([proposal!.key]);
  });

  it("keeps a mark Laskut puts on the same series from answering the question", async () => {
    const t = await withLoanRows();
    const [proposal] = await t.proposals();
    await t.admin.call("PUT", "/api/marks", { subject: `series:${proposal!.key}`, mark: "in_use" });
    expect((await t.proposals()).map((p) => p.key)).toEqual([proposal!.key]);
  });

  it("shows a member only their own rows, and an answer of someone else changes nothing for them", async () => {
    const t = await withLoanRows();
    const pekka = await t.member("pekka");
    // the member has no rows: the admin's series is not theirs
    expect(await t.proposals(pekka)).toEqual([]);

    await t.user(pekka.id);
    const [mine] = await t.proposals(pekka);
    const [admins] = await t.proposals();
    expect(mine!.key).not.toBe(admins!.key);

    // the admin answers: the member still has theirs
    const { subject, mark } = notLoanMark({ key: admins!.key });
    await t.admin.call("PUT", "/api/marks", { subject, mark });
    expect(await t.proposals()).toEqual([]);
    expect((await t.proposals(pekka)).map((p) => p.key)).toEqual([mine!.key]);
  });

  it("names on the front page, in either view, only what the list of proposals shows", async () => {
    // a bank the app cannot place by its name: a finance company's steady payment is a loan with no question
    const t = await withLoanRows(rows.map((r) => (r.amountCents < 0 ? { ...r, counterparty: "ESIMERKKIPANKKI OYJ" } : r)));
    const named = async (scope: string) => {
      const items = (await t.admin.call("GET", `/api/dashboard?scope=${scope}`)).body.questions.items as { kind: string; key?: string }[];
      return items.filter((i) => i.kind === "loan").map((i) => i.key);
    };
    const [proposal] = await t.proposals();
    expect(await named("own")).toEqual([proposal!.key]);
    expect(await named("household")).toEqual([proposal!.key]);
    const { subject, mark } = notLoanMark({ key: proposal!.key });
    await t.admin.call("PUT", "/api/marks", { subject, mark });
    expect(await named("household")).toEqual([]);
  });
});

describe("a loan saved under an old spelling of a card issuer's name", () => {
  // the upgrade gave the issuer one name, so the instalments that come now carry "Morrow Bank"; the loan's key is not rewritten
  const issuerRows = [4, 5, 6, 7, 8, 9, 10].map((month) => raw(`2026-${String(month).padStart(2, "0")}-05`, -250, "MORROW BANK ASA", "LAINAN LYHENNYS"));
  async function withIssuerLoan(keyName: string) {
    const t = await setupApp();
    const repo = t.s.finance(t.adminId);
    await repo.upsertAccount({ id: "chk-issuer", connectionId: null, provider: "csv", externalId: null, identity: null, name: "Käyttötili", iban: null, currency: "EUR", type: "checking" });
    await ingestTransactions(repo, "chk-issuer", issuerRows, "csv");
    await reprocess(repo, t.s.settings);
    const proposals = async () => (await t.admin.call("GET", "/api/loans/proposals")).body.proposals as { key: string; payee: string }[];
    const [proposal] = await proposals();
    expect(proposal!.key).toBe("out:chk-issuer:Morrow Bank#25000");
    const saved = await t.admin.call("POST", "/api/loans", { name: "Kulutusluotto", kind: "consumer", balanceCents: 900_000, balanceDate: "2026-10-01", paymentCents: 25000, intervalMonths: 1, seriesKey: `out:chk-issuer:${keyName}#25000` });
    expect(saved.status).toBe(200);
    return { proposals, key: saved.body.loan.seriesKey as string, admin: t.admin, id: saved.body.loan.id as string };
  }

  it("still reaches the new instalments, and the loan's own key stays as it was saved", async () => {
    const t = await withIssuerLoan("Morrow Bank Asa");
    expect(await t.proposals()).toEqual([]);
    expect(t.key).toBe("out:chk-issuer:Morrow Bank Asa#25000");
  });

  it("another issuer's loan does not", async () => {
    const t = await withIssuerLoan("Bank Norwegian");
    expect((await t.proposals()).map((p) => p.key)).toEqual(["out:chk-issuer:Morrow Bank#25000"]);
  });

  it("a key with no amount matches the one name only while it is the only loan in it; two loans in one name keep to their own spellings", async () => {
    const t = await withIssuerLoan("Morrow Bank Asa");
    await t.admin.call("DELETE", `/api/loans/${t.id}`);
    const save = async (seriesKey: string) => expect((await t.admin.call("POST", "/api/loans", { name: "Kulutusluotto", kind: "consumer", balanceCents: 900_000, balanceDate: "2026-10-01", paymentCents: 25000, intervalMonths: 1, seriesKey })).status).toBe(200);
    await save("out:chk-issuer:Morrow Bank Asa");
    expect(await t.proposals()).toEqual([]);
    await save("out:chk-issuer:Komplett Bank Asa");
    expect((await t.proposals()).map((p) => p.key)).toEqual(["out:chk-issuer:Morrow Bank#25000"]);
  });
});
