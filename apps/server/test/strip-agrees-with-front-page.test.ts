/**
 * The strip above Tapahtumat tells a month's Menot, Tulot and what moved to or from savings from the same flows as the
 * front page, so its terms add up to the month's Tulos: Erotus less the savings moved, plus the credit drawn. A month
 * with a refund, a payment to savings that arrived a fee short and the rows of a loan account holds each of the cases
 * where the strip once added up the signs of the rows instead.
 */
import { addMonths, monthEnd, type RawTransaction } from "@banking/core";
import { describe, expect, it } from "vitest";
import { reprocess } from "../src/services/enrich.ts";
import { ingestTransactions } from "../src/services/ingest.ts";
import { type Client, setupApp } from "./helpers.ts";

const [CHECKING_IBAN, SAVINGS_IBAN, LOAN_IBAN] = ["FI2112345600000785", "FI4950009420028730", "FI9810000000012349"];

const raw = (bookingDate: string, euros: number, extra: Partial<RawTransaction> = {}): RawTransaction => ({
  externalId: null, bookingDate, valueDate: null, amountCents: Math.round(euros * 100), currency: "EUR", status: "booked",
  counterparty: null, counterpartyIban: null, description: null, reference: null, mcc: null, ...extra,
});

type Strip = { inCents: number; outCents: number; netCents: number; savedCents: number };
type Totals = { incomeCents: number; expenseCents: number; savedCents: number; borrowedCents: number; leftCents: number };

/** The strip of a month and the front page's totals for it, over the same range. */
async function monthOf(client: Client, month: string): Promise<{ strip: Strip; totals: Totals }> {
  const range = `from=${month}-01&to=${monthEnd(month)}`;
  const strip = (await client.call("GET", `/api/transactions?${range}&limit=1`)).body;
  const totals = (await client.call("GET", `/api/dashboard?${range}&scope=own`)).body.totals;
  return { strip, totals };
}

function expectAgreement(strip: Strip, totals: Totals, label: string) {
  expect({ inCents: strip.inCents, outCents: strip.outCents, savedCents: strip.savedCents }, label).toEqual({ inCents: totals.incomeCents, outCents: totals.expenseCents, savedCents: totals.savedCents });
  // Erotus less what moved to savings, with the credit drawn, is Tulos
  expect(strip.netCents - strip.savedCents + totals.borrowedCents, label).toBe(totals.leftCents);
}

describe("the strip of Tapahtumat and the front page", () => {
  it("add up to the same Tulos in a month with a refund, a payment to savings that arrived short and a loan account's rows", async () => {
    const app = await setupApp();
    const repo = app.s.finance(app.adminId);
    for (const [id, iban, type] of [["checking", CHECKING_IBAN, "checking"], ["savings", SAVINGS_IBAN, "savings"], ["loan", LOAN_IBAN, "loan"]] as const) {
      await repo.upsertAccount({ id, connectionId: null, provider: "enablebanking", externalId: null, identity: `idn-${id}`, name: id, holder: null, iban, currency: "EUR", type });
    }
    await ingestTransactions(
      repo,
      "checking",
      [
        raw("2026-09-02", 2400, { counterparty: "TYÖNANTAJA OY", description: "Palkka" }),
        raw("2026-09-05", -60, { counterparty: "KAUPPA OY", mcc: "5411" }),
        raw("2026-09-08", 15, { counterparty: "KAUPPA OY", mcc: "5411" }),
        raw("2026-09-10", -500, { counterpartyIban: SAVINGS_IBAN, description: "Siirto" }),
        raw("2026-09-15", -300, { counterpartyIban: LOAN_IBAN, description: "Lainanlyhennys" }),
      ],
      "enablebanking",
    );
    await ingestTransactions(repo, "savings", [raw("2026-09-11", 499, { description: "Siirto" })], "enablebanking");
    await ingestTransactions(repo, "loan", [raw("2026-09-16", 300, { description: "Lyhennys" }), raw("2026-09-30", -12, { description: "Korko" })], "enablebanking");
    await reprocess(repo, app.s.settings);
    const { strip, totals } = await monthOf(app.admin, "2026-09");
    // the refund lowers Menot, the loan account's rows are neutral, the move to savings is saved and its fee is spent
    expect(strip.savedCents).toBe(totals.savedCents);
    expect(strip.savedCents).not.toBe(0);
    expectAgreement(strip, totals, "2026-09");
  });

  it("agree in every complete month of the demo data", async () => {
    const app = await setupApp({}, undefined, { now: () => new Date("2026-10-09T10:00:00Z") });
    expect((await app.admin.call("POST", "/api/demo")).status).toBe(200);
    for (let back = 1; back <= 11; back++) {
      const month = addMonths("2026-10", -back);
      const { strip, totals } = await monthOf(app.admin, month);
      expectAgreement(strip, totals, month);
    }
  }, 120_000);
});
