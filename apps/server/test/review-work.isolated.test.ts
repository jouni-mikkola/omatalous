/**
 * The work behind the review count, the queue and the dashboard: the header asks for the count on every page and the
 * front page reads the queue and the dashboard beside it, so the loan proposals and the questions of one context and
 * one set of inputs are worked out once between them. An answer, a new day or new data works them out again. Isolated:
 * it counts the calls of two core functions through a mock. Made-up names and sums; the test clock is 9.10.2026.
 */
import { notLoanMark, type RawTransaction } from "@banking/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { reprocess } from "../src/services/enrich.ts";
import { ingestTransactions } from "../src/services/ingest.ts";
import { setupApp } from "./helpers.ts";

const calls = { loanProposals: 0, buildQuestions: 0 };
vi.mock("@banking/core", async (importOriginal) => {
  const core = await importOriginal<typeof import("@banking/core")>();
  return {
    ...core,
    loanProposals: (...args: Parameters<typeof core.loanProposals>) => (calls.loanProposals++, core.loanProposals(...args)),
    buildQuestions: (...args: Parameters<typeof core.buildQuestions>) => (calls.buildQuestions++, core.buildQuestions(...args)),
  };
});

const raw = (bookingDate: string, euros: number, counterparty: string, description: string): RawTransaction => ({
  externalId: null, bookingDate, valueDate: null, amountCents: Math.round(euros * 100), currency: "EUR", status: "booked",
  counterparty, counterpartyIban: null, description, reference: null, mcc: null,
});
const ROWS = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((m) => `2026-${String(m).padStart(2, "0")}`).flatMap((m) => [
  raw(`${m}-05`, -250, "ESIMERKKIRAHOITUS OY", "LAINAN LYHENNYS"),
  raw(`${m}-20`, -84.5, "KUMMAKAUPPA XYZ", "KORTTIOSTO"),
  raw(`${m}-15`, 3200, "ESIMERKKITYÖNANTAJA OY", "PALKKA"),
]);

async function household() {
  const t = await setupApp();
  const repo = t.s.finance(t.adminId);
  await repo.upsertAccount({ id: "chk", connectionId: null, provider: "csv", externalId: null, identity: null, name: "Käyttötili", iban: null, currency: "EUR", type: "checking" });
  await ingestTransactions(repo, "chk", ROWS, "csv");
  await reprocess(repo, t.s.settings);
  return t;
}
type T = Awaited<ReturnType<typeof household>>;
/** What the front page asks when it opens: the header's count, the queue and the dashboard. */
const frontPage = async (t: T) => {
  const [count, queue, dashboard] = await Promise.all([t.admin.call("GET", "/api/review/count"), t.admin.call("GET", "/api/review"), t.admin.call("GET", "/api/dashboard?scope=own")]);
  for (const r of [count, queue, dashboard]) expect(r.status).toBe(200);
  return { count: count.body.count as number, items: queue.body.items as { id: string; kind: string; key?: string }[] };
};

beforeEach(() => {
  calls.loanProposals = 0;
  calls.buildQuestions = 0;
});

describe("the work behind the review queue", () => {
  it("works out the proposals and the questions once for the count, the queue and the dashboard, and the count is the queue's length", async () => {
    const t = await household();
    const first = await frontPage(t);
    expect(first.items.map((i) => i.kind)).toContain("loan");
    expect(first.count).toBe(first.items.length);
    expect(calls).toEqual({ loanProposals: 1, buildQuestions: 1 });
    // the next page asks for the count again: nothing is worked out again, and the answer is the same
    expect((await t.admin.call("GET", "/api/review/count")).body.count).toBe(first.count);
    expect((await frontPage(t)).items).toEqual(first.items);
    expect(calls).toEqual({ loanProposals: 1, buildQuestions: 1 });
  });

  it("an answer, a new day and new rows work them out again, and the queue says what changed", async () => {
    const t = await household();
    const loan = (await frontPage(t)).items.find((i) => i.kind === "loan")!;
    expect((await t.admin.call("PUT", "/api/marks", notLoanMark({ key: loan.key! }))).status).toBe(200);
    const answered = await frontPage(t);
    expect(answered.items.map((i) => i.id)).not.toContain(loan.id);
    expect(answered.count).toBe(answered.items.length);
    expect(calls).toEqual({ loanProposals: 2, buildQuestions: 2 });

    const nextDay = vi.spyOn(t.s, "today").mockReturnValue("2026-10-10");
    try {
      await frontPage(t);
      expect(calls.buildQuestions).toBe(3);
    } finally {
      nextDay.mockRestore();
    }

    const repo = t.s.finance(t.adminId);
    await ingestTransactions(repo, "chk", [raw("2026-10-08", -61.2, "TOINEN KAUPPA XYZ", "KORTTIOSTO")], "csv");
    await reprocess(repo, t.s.settings);
    const after = await frontPage(t);
    expect(after.count).toBe(after.items.length);
    expect(calls.loanProposals).toBeGreaterThan(2);
  });
});
