/**
 * The figures of today that no range of rows adds up: what the accounts hold (`holdings.accounts`, Käyttötilin saldo, ilman korttia), what the
 * checking accounts have free until the payday (`ahead.free`, Käytettävissä) and the pay the window waits for
 * (`ahead.pay`). Their lines are accounts, coming payments and past pays, read from the same run that gives the page its
 * figure (`aheadBasis`, `buildHoldings`). A line that is no row has an id of its own (`a:` an account, `due:` a coming
 * payment, `card:` a card's debt that no bill holds); the answer's names give each its name, as they do a row.
 */
import { aheadBasis } from "../analysis/ahead.ts";
import type { AnalysisContext } from "../analysis/context.ts";
import { buildHoldings } from "../holdings.ts";
import type { BalanceInput, UserInputs } from "../types.ts";
import { payRule } from "./catalogue.ts";
import type { Explanation, Line, Reason } from "./types.ts";

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
    // the balances it starts from, then every payment of the window and each card's debt no bill of it holds; a pay adds nothing to it
    // an account no row proves says so: its balance is the bank's word
    const proofOf = new Map(balances.map((b) => [b.id, b.proof]));
    const start = basis.checking.map((a): Line => {
      const proof = proofOf.get(a.id);
      return { id: `a:${a.id}`, day: ahead.from, cents: a.cents, why: proof?.status === "unknown" && proof.reason ? [{ rule: "balance.unproven", reason: proof.reason }] : [] };
    });
    const due = ahead.rows.flatMap((r, i): Line[] => (r.source === "income" || r.cents === null ? [] : [{ id: `due:${i}`, day: r.date, cents: r.cents, why: [] }]));
    // a card with a payment its balance may hold has a line even when a bill of the window holds all its debt: the line is then 0
    const unshown = new Map((balance.unshown ?? []).map((u) => [u.cardId, u]));
    const owing = [...balance.cardDebts, ...(balance.unshown ?? []).filter((u) => !balance.cardDebts.some((c) => c.cardId === u.cardId)).map((u) => ({ cardId: u.cardId, name: u.name, cents: 0 }))];
    const open = new Map(balance.unresolved.map((u) => [u.cardId, u]));
    const cards = owing.map((c): Line => {
      const card = open.get(c.cardId);
      const payer: Reason[] = !card ? [] : card.reason === "card_payer_unseen" ? [{ rule: "card.payer_unseen" }] : [{ rule: "card.payer_mixed", pool: card.paidFromPoolCents ?? 0, outside: card.paidFromOutsideCents ?? 0 }];
      return { id: `card:${c.cardId}`, day: ahead.from, cents: -c.cents, why: [...(unshown.has(c.cardId) ? [{ rule: "card.unshown", cents: unshown.get(c.cardId)!.cents } as Reason] : []), ...payer] };
    });
    const lines = [...start, ...due, ...cards];
    return {
      explanation: { figure, kind: "sum", cents: balance.freeCents, lines, check: { kind: "sum", diffCents: balance.freeCents - sumOf(lines) } },
      names: [
        ...basis.checking.map((a) => ({ id: `a:${a.id}`, merchant: a.name, category: "" })),
        ...ahead.rows.flatMap((r, i) => (r.source === "income" || r.cents === null ? [] : [{ id: `due:${i}`, merchant: r.name, category: r.category ?? "" }])),
        ...owing.map((c) => ({ id: `card:${c.cardId}`, merchant: c.name, category: "" })),
      ],
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
