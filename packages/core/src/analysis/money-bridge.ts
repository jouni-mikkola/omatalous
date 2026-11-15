// Decision: where the money went, so the household sees in one sum what moved the accounts
import { type BalanceChange, balanceChange, balanceDays } from "./balance-change.ts";
import { balanceWalk } from "./balance-walk.ts";
import type { AnalysisContext, AnalysisTx } from "./context.ts";
import type { DateRange } from "./period.ts";
import { dayNumber } from "../dates.ts";
import type { BalanceInput } from "../types.ts";

/**
 * The lines of the bridge from income to the change of the accounts, in the order they are told. The first four are the
 * bridge of the cash flow and are always there. The others appear when a row falls in them, so the lines add up to the
 * change with no remainder.
 */
const BRIDGE_LINES = ["income", "consumption", "debt", "investedOut", "borrowed", "transfersOut", "loanAccounts"] as const;
type BridgeLineKey = (typeof BRIDGE_LINES)[number];

/** The lines that are in the bridge when no row falls in them. */
const ALWAYS: ReadonlySet<BridgeLineKey> = new Set(["income", "consumption", "debt", "investedOut"]);

interface MoneyBridgeLine {
  key: BridgeLineKey;
  /** What the line's rows did to the accounts: money in is above zero, money out below. The lines add up to `changeCents` with plain plus. */
  cents: number;
  /** The filter to the rows: the booked rows of the line, on the accounts the change counts, between `from` (not included) and `to`. */
  rowIds: string[];
}

export interface MoneyBridge {
  /** The same days and the same cents as `BalanceReport.change`: one definition of the change. */
  from: BalanceChange["from"];
  to: BalanceChange["to"];
  basis: BalanceChange["basis"];
  changeCents: number;
  lines: MoneyBridgeLine[];
}

/**
 * Which line a row belongs to. Income, consumption and debt are what the money flows (`Flows`) say. Money put in a
 * savings category is `investedOut`, and a transfer, which is neutral between two connected accounts, shows as
 * `transfersOut` only for what is left when one end is outside the accounts. A loan account's own rows mirror payments
 * counted from the checking account (`flowsOf`), so they are a line of their own.
 */
function bridgeLineOf(t: Pick<AnalysisTx, "flows" | "isTransfer">, onLoanAccount: boolean): BridgeLineKey {
  const f = t.flows;
  if (f.income !== 0) return "income";
  if (f.consumption !== 0) return "consumption";
  if (f.debt !== 0) return "debt";
  if (f.saved !== 0 && !t.isTransfer) return "investedOut";
  if (f.borrowed !== 0) return "borrowed";
  return onLoanAccount ? "loanAccounts" : "transfersOut";
}

/**
 * The bridge from the money in to the change of the accounts' total (`balanceChange`): every booked row of the days
 * after `change.from` up to `change.to`, on an account with a balance, is in exactly one line. Null when the change is.
 */
export function moneyBridge(ctx: AnalysisContext, range: DateRange, balances: readonly BalanceInput[]): MoneyBridge | null {
  const walks = balances.flatMap((b) => balanceWalk(ctx, b) ?? []);
  const { fromDay, toDay } = balanceDays(ctx, range);
  const change = balanceChange(walks, fromDay, toDay);
  if (!change) return null;
  const counted = new Set(walks.map((w) => w.accountId));
  const loans = new Set(ctx.accounts.filter((a) => a.type === "loan").map((a) => a.id));
  const lines = new Map(BRIDGE_LINES.map((key): [BridgeLineKey, MoneyBridgeLine] => [key, { key, cents: 0, rowIds: [] }]));
  const first = dayNumber(change.from);
  for (const t of ctx.txs) {
    if (t.status !== "booked" || !counted.has(t.accountId) || t.day <= first || t.day > toDay) continue;
    const line = lines.get(bridgeLineOf(t, loans.has(t.accountId)))!;
    line.cents += t.amountCents;
    line.rowIds.push(t.id);
  }
  return { from: change.from, to: change.to, basis: change.basis, changeCents: change.cents, lines: [...lines.values()].filter((l) => ALWAYS.has(l.key) || l.rowIds.length) };
}
