/**
 * Täydennä lainat lists a saved loan once, whatever a proposal says of its series. The detector leaves out a series a saved
 * loan is linked to (`takenSeries`), so the list's own guard, the loan's `seriesKey` as the row's series, is reached only
 * by a proposal the detector let through: this file adds one to the proposals the way a miss would, so a row that stops
 * passing the key on shows a second row. Made-up names and sums; the test clock is 9.10.2026.
 */
import type { LoanProposal } from "@banking/core";
import { describe, expect, it, vi } from "vitest";
import { reprocess } from "../src/services/enrich.ts";
import { setupApp } from "./helpers.ts";

const missed = vi.hoisted(() => ({ proposals: [] as LoanProposal[] }));
vi.mock("../src/services/request-inputs.ts", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/services/request-inputs.ts")>();
  return { ...real, proposalsOf: (...args: Parameters<typeof real.proposalsOf>) => [...real.proposalsOf(...args), ...missed.proposals] };
});

type Debt = { source: string; loanId: string | null; key: string | null };
type Item = { kind: string; debts?: Debt[] };

const KEY = "out:chk:Esimerkkirahoitus";
const proposal = (key: string): LoanProposal => ({
  key,
  seriesId: key,
  payee: "Esimerkkirahoitus",
  accountId: "chk",
  paymentCents: 90_000,
  monthlyCents: 90_000,
  months: 3,
  firstDate: "2026-08-02",
  lastDate: "2026-10-02",
  category: "loans",
  kind: "mortgage",
  reference: null,
  placed: true,
  plan: false,
  planAnswer: null,
});

const debtsOf = async (seriesKey: string | null, proposals: LoanProposal[]) => {
  missed.proposals = proposals;
  const t = await setupApp();
  const repo = t.s.finance(t.adminId);
  await repo.upsertAccount({ id: "chk", connectionId: null, provider: "csv", externalId: null, identity: null, name: "chk", iban: null, currency: "EUR", type: "checking" });
  await repo.setAccountBalance("chk", 100_000, "2026-10-09T06:00:00.000Z");
  await reprocess(repo, t.s.settings);
  const body = { name: "Asuntolaina", kind: "mortgage", balanceCents: 15_000_000, balanceDate: "2026-10-01", repayment: "annuity", intervalMonths: 1, paymentCents: 90_000, seriesKey };
  const id = (await t.admin.call("POST", "/api/loans", body)).body.loan.id as string;
  const list = ((await t.admin.call("GET", "/api/review")).body.items as Item[]).find((i) => i.kind === "loan_terms_list");
  return { id, debts: list?.debts ?? [] };
};

describe("Täydennä lainat, a proposal of a saved loan's series", () => {
  it("is no second row: the saved loan's row keeps the series", async () => {
    const { id, debts } = await debtsOf(KEY, [proposal(KEY)]);
    expect(debts.map((d) => [d.source, d.loanId])).toEqual([["loan", id]]);
  });

  it("is a row of its own while no saved loan holds its series", async () => {
    const { id, debts } = await debtsOf("out:chk:Toinen", [proposal(KEY)]);
    // the same year of payments: the saved loan, told first, stays first
    expect(debts.map((d) => [d.source, d.loanId, d.key])).toEqual([
      ["loan", id, null],
      ["proposal", null, KEY],
    ]);
  });
});
