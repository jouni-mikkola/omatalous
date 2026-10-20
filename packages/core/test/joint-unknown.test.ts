/**
 * A joint account's split is said, never assumed (ADR 0017, owner rule L5): holder names tell who sees an account, and
 * until a member says the split each user counts it whole, flagged. Made-up names and sums.
 */
import { describe, expect, it } from "vitest";
import { applyUse, deriveUse, isUntold, partCents, partOf, saidUse, type UseMember, WHOLE } from "../src/account-use.ts";
import { createContext } from "../src/analysis/context.ts";
import { dayNumber as d } from "../src/dates.ts";
import { type Owner, type TraceRow, trace } from "../src/money-trace.ts";
import { nameOf } from "../src/person-names.ts";
import type { AgreementRow } from "../src/settlement-agreements.ts";
import type { SettlementPool } from "../src/settlement-ledger.ts";
import { incomeReport } from "../src/reports/income.ts";
import { settlement } from "../src/settlement.ts";
import type { Account, BalanceInput } from "../src/types.ts";
import { series, tx } from "./helpers.ts";

const MATTI = "MEIKALAINEN MATTI";
const ELISA = "KORHONEN ELISA";
const JOINT = { holder: `${MATTI}, ${ELISA}` };
const members: UseMember[] = [
  { id: "u-1", label: "Matti", name: nameOf(MATTI) },
  { id: "u-2", label: "Elisa", name: nameOf(ELISA) },
];

describe("a joint account nobody has split", () => {
  it("two holders and no answer: each user counts it whole, flagged, and no figure is halved", () => {
    const use = deriveUse(JOINT, ["u-1"], members);
    expect(use.split).toBe("unknown");
    for (const id of ["u-1", "u-2"]) {
      const part = partOf(use, id);
      expect(isUntold(part), id).toBe(true);
      expect(partCents(-12345, part)).toBe(-12345);
    }
    // the rows of the account come back as the bank booked them
    const account = { id: "chk", type: "checking", holder: JOINT.holder } as Account;
    const rows = [tx({ id: "a", accountId: "chk", bookingDate: "2026-09-03", amountCents: -4000 })];
    expect(applyUse(rows, [account], new Map([["chk", partOf(use, "u-1")]]))).toBe(rows);
  });

  it("an answer of 70 and 30 gives the parts it says, unflagged", () => {
    const said = saidUse([{ userId: "u-1", weight: 70 }, { userId: "u-2", weight: 30 }], JOINT, ["u-1"], members)!;
    const part = partOf(said, "u-1");
    expect(said.split).toBeUndefined();
    expect(isUntold(part)).toBe(false);
    expect((part.to - part.from) / part.of).toBe(0.7);
    expect(partCents(-10000, part)).toBe(-7000);
  });

  it("rows cut by who paid follow the split the household chose: the weights stand", () => {
    const use = deriveUse(JOINT, ["u-1"], members);
    expect(partOf({ ...use, mode: "source" }, "u-1")).toEqual({ from: 0, to: 1, of: 2 });
  });

  it("one user has no split to tell: the plain whole", () => {
    const alone = deriveUse({ holder: MATTI }, ["u-1"], members);
    expect(alone.split).toBeUndefined();
    expect(partOf(alone, "u-1")).toBe(WHOLE);
  });
});

describe("the settlement of a pool nobody has split", () => {
  const A: Owner = "u:1";
  const B: Owner = "u:2";
  const POOL = "iban-yhteinen";
  const row = (label: string, date: string, cents: number, extra: Partial<TraceRow> = {}): TraceRow => ({ key: `${d(date)}|${cents}|${label}|00000`, ids: [label], day: d(date), cents, ...extra });
  const rows = [row("in", "2026-09-01", 100000, { from: { owner: A, kind: "own" } }), row("rent", "2026-09-05", -84364)];
  const pool = (split?: "unknown"): SettlementPool => ({
    key: POOL,
    trace: trace(rows, 0, d("2026-09-01")),
    answers: [],
    users: [{ owner: A, weight: 1 }, { owner: B, weight: 1 }],
    ...(split ? { split } : {}),
  });
  const run = (p: SettlementPool, agreements: AgreementRow[] = []) => settlement("2026-09", p, agreements, new Set([A, B]), [], new Map(), "2026-10-15");

  it("computes no share and nobody paid more: the cost is listed as untold", () => {
    const s = run(pool("unknown"));
    expect(s.untold).toEqual([{ key: rows[1]!.key, day: d("2026-09-05"), cents: 84364 }]);
    expect(s.members.every((m) => m.owed === 0 && m.over === 0)).toBe(true);
    expect(s.lines.filter((l) => l.kind === "cost")).toEqual([]);
  });

  it("near miss: a said use shares the cost by its weights", () => {
    const s = run(pool());
    expect(s.untold).toBeUndefined();
    expect(s.members.find((m) => m.owner === A)).toMatchObject({ paid: 84364, owed: 42182, over: 42182 });
  });

  it("an agreement says the split, also where the use is untold", () => {
    const s = run(pool("unknown"), [{ accountKey: POOL, validFrom: "2026-01-01", kind: "share", value: { weights: { [A]: 3, [B]: 1 } } }]);
    expect(s.untold).toBeUndefined();
    expect(s.members.find((m) => m.owner === B)).toMatchObject({ paid: 0, owed: 21091 });
  });
});

describe("the income of a joint account nobody has split, in the household view", () => {
  it("is one line of the whole account, never the whole once per user", () => {
    const accounts: Account[] = [{ id: "acc-1", name: "Yhteinen", iban: null, currency: "EUR", type: "checking" }];
    const rows = series("2025-11-15", 30, 12, 300000, { accountId: "acc-1", merchant: "Yritys Oy", counterparty: "Yritys Oy", category: "salary", categorySource: "rule" });
    const ctx = createContext(rows, accounts, "2026-10-20");
    const balance = (use: BalanceInput["use"]) => [{ id: "acc-1", name: "Yhteinen", type: "checking", balanceCents: 0, ownerName: null, use } as BalanceInput];
    const untold = incomeReport(ctx, { from: "2025-11-01", to: "2026-10-20" }, balance(deriveUse(JOINT, ["u-1"], members)));
    expect(untold.members).toBeNull();
    // near miss: a said use splits it by its weights, and the lines add up to the account
    const said = incomeReport(ctx, { from: "2025-11-01", to: "2026-10-20" }, balance(saidUse([{ userId: "u-1", weight: 1 }, { userId: "u-2", weight: 1 }], JOINT, ["u-1"], members)!));
    expect(said.members!.map((m) => m.label)).toEqual(["Matti", "Elisa"]);
    expect(said.members!.reduce((n, m) => n + m.earnedCents, 0)).toBe(untold.earnedCents);
  });
});
