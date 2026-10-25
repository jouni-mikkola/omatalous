/**
 * The figures of today that no range of rows adds up: what the accounts hold (`holdings.accounts`, Tilien saldo, ilman korttia), what the
 * checking accounts have free until the payday (`ahead.free`, Käytettävissä) and the pay the window waits for
 * (`ahead.pay`). Their lines are accounts, coming payments and past pays, read from the same run that gives the page its
 * figure (`aheadBasis`, `buildHoldings`). A line that is no row has an id of its own (`a:` an account, `due:` a coming
 * payment); the answer's names give each its name, as they do a row.
 */
import { aheadBasis } from "../analysis/ahead.ts";
import type { AnalysisContext } from "../analysis/context.ts";
import { buildHoldings } from "../holdings.ts";
import type { BalanceInput, UserInputs } from "../types.ts";
import { payRule } from "./catalogue.ts";
import type { Explanation, Line } from "./types.ts";

/** What names a line: the account, the payee or the bill, and its category ("" for an account). */
interface NowName {
  id: string;
  merchant: string;
  category: string;
}

type NowFigure = "holdings.accounts" | "ahead.free" | "ahead.pay";

const sumOf = (lines: readonly Line[]): number => lines.reduce((s, l) => s + l.cents, 0);

/** The basis of one of today's figures, and the names of the lines that are no row (a pay is a row, named as rows are). */
export function explainNow(figure: NowFigure, ctx: AnalysisContext, balances: readonly BalanceInput[], inputs: UserInputs): { explanation: Explanation; names: NowName[] } {
  const basis = aheadBasis(ctx, balances, inputs);
  const { ahead } = basis;
  if (figure === "holdings.accounts") {
    const holdings = buildHoldings(ctx, balances, inputs);
    const known = holdings.accounts.filter((a) => a.balanceCents !== null);
    const lines = known.map((a): Line => ({ id: `a:${a.id}`, day: ahead.from, cents: a.balanceCents!, why: [] }));
    const cents = holdings.accountsCents;
    return {
      explanation: { figure, kind: "sum", cents, lines, check: cents === null ? { kind: "n/a" } : { kind: "sum", diffCents: cents - sumOf(lines) } },
      names: known.map((a) => ({ id: `a:${a.id}`, merchant: a.name, category: "" })),
    };
  }
  if (figure === "ahead.free") {
    const balance = ahead.balance;
    if (!balance) return { explanation: { figure, kind: "sum", cents: null, lines: [], check: { kind: "n/a" } }, names: [] };
    // the balances it starts from, then every payment of the window; a pay adds nothing to it
    const start = basis.checking.map((a): Line => ({ id: `a:${a.id}`, day: ahead.from, cents: a.cents, why: [] }));
    const due = ahead.rows.flatMap((r, i): Line[] => (r.source === "income" || r.cents === null ? [] : [{ id: `due:${i}`, day: r.date, cents: r.cents, why: [] }]));
    const lines = [...start, ...due];
    return {
      explanation: { figure, kind: "sum", cents: balance.freeCents, lines, check: { kind: "sum", diffCents: balance.freeCents - sumOf(lines) } },
      names: [...basis.checking.map((a) => ({ id: `a:${a.id}`, merchant: a.name, category: "" })), ...ahead.rows.flatMap((r, i) => (r.source === "income" || r.cents === null ? [] : [{ id: `due:${i}`, merchant: r.name, category: r.category ?? "" }]))],
    };
  }
  const pay = ahead.payday?.pay ?? null;
  // the pays are rows of the view: the answer names them as it names any row
  return {
    explanation: {
      figure,
      kind: "median",
      // the figure the page shows: the median of a steady pay, the low end of the range of one that varies
      cents: pay ? (pay.kind === "steady" ? pay.usualCents : pay.floorCents) : null,
      lines: basis.pays.map((p): Line => ({ id: p.id!, day: p.date, cents: p.cents, why: [] })),
      method: { kind: "estimate", rule: pay ? payRule(pay.count, pay.kind === "steady", !!pay.season) : "" },
      check: { kind: "n/a" },
    },
    names: [],
  };
}
