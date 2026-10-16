/**
 * The figures that are not a sum of the rows of a range: a balance (the bank's balance walked to a day), a part of one
 * joint-account row, and an estimate. Each says what it is; none is explained by a weight or a guess it does not name.
 */
import { billCents, partCents, partOf } from "../account-use.ts";
import { balanceRows, balanceWalk } from "../analysis/balance-walk.ts";
import { cashAhead } from "../analysis/ahead.ts";
import type { AnalysisContext } from "../analysis/context.ts";
import { dayNumber, monthEnd, monthOf } from "../dates.ts";
import { buildHoldings } from "../holdings.ts";
import { balanceReport } from "../reports/balances.ts";
import { NO_INPUTS } from "../types.ts";
import type { ExplainArgs, Explanation, FigureId, Line, Reason } from "./types.ts";

const sumLines = (lines: readonly Line[]): number => lines.reduce((s, l) => s + l.cents, 0);

/**
 * `balance.account`: the balance at the end of the range's month, today's for the month in progress (as `balanceReport`
 * has it): the bank's balance and the booked rows between its day and that day (`balanceRows`).
 * `balance.view`: the page's "Tilit yhteensä", `buildHoldings(...).accountsCents`, the accounts only (no card, no loan),
 * today; its lines are those accounts' balances as the walk tells them, so the check compares the walk with the page.
 * A pending row is in neither, as the bank leaves it out of the balance. A balance the walk cannot tell (before the
 * account's first row, a row in another currency) is null.
 */
export function explainBalance(figure: "balance.account" | "balance.view", ctx: AnalysisContext, args: ExplainArgs): Explanation {
  const month = monthOf(args.range.to);
  const day = Math.min(dayNumber(monthEnd(month)), ctx.todayDay);
  if (figure === "balance.view") return explainAccountsTotal(ctx, args);
  const accounts = (args.balances ?? []).filter((b) => args.accountIds?.includes(b.id));
  if (args.accountIds?.length !== 1 || accounts.length !== 1) throw new Error("explain: balance.account needs one account with a balance");
  const cents = balanceReport(ctx, { from: `${month}-01`, to: monthEnd(month) }, accounts).total.at(-1) ?? null;
  const why = (id: string): Reason[] => [...(args.why?.of(id) ?? [])];
  const lines: Line[] = [];
  if (cents !== null) {
    const found = balanceRows(ctx, accounts[0]!, day);
    if (found) {
      lines.push({ id: accounts[0]!.id, day: found.openingDay, cents: found.openingCents, why: [] });
      lines.push(...found.rows.map(({ tx, cents: c }) => ({ id: tx.id, day: tx.bookingDate, cents: c, why: why(tx.id) })));
    }
  }
  return { figure, kind: "sum", cents, lines, check: cents === null ? { kind: "n/a" } : { kind: "sum", diffCents: cents - sumLines(lines) } };
}

/** `balance.view`: the page's total of its accounts, each account's balance by the walk to today as a line. */
function explainAccountsTotal(ctx: AnalysisContext, args: ExplainArgs): Explanation {
  if (args.accountIds) throw new Error("explain: balance.view is not a figure of some accounts");
  const held = buildHoldings(ctx, args.balances ?? [], args.inputs ?? NO_INPUTS);
  const cents = held.accountsCents;
  const shown = new Set(held.accounts.map((a) => a.id));
  const lines: Line[] = [];
  for (const a of (args.balances ?? []).filter((b) => shown.has(b.id))) {
    const at = balanceWalk(ctx, a)?.at(ctx.todayDay) ?? null;
    if (at !== null) lines.push({ id: a.id, day: ctx.today, cents: at, why: [] });
  }
  return { figure: "balance.view", kind: "sum", cents, lines, check: cents === null ? { kind: "n/a" } : { kind: "sum", diffCents: cents - sumLines(lines) } };
}

/** Whether a part got more than its exact share, `whole * (to - from) / of`: the cent nobody could share went to it. */
const gotTheCent = (whole: number, cents: number, part: { from: number; to: number; of: number }): boolean => Math.abs(cents) * part.of > Math.abs(whole) * (part.to - part.from);

/**
 * `share.part`: what one row of a joint account counts for the viewing user. A row of a traced account says whose money
 * its parts were (`part.source`) and cuts only the unknown parts (`part.use`): the lines are the reasons the collector
 * holds for it, and the check recomputes the viewer's cents from them. Any other row is cut by the weights: one line per
 * user, each with its part (`part.use`, and `rounding.cent` where the part got the cent that could not be shared), and the check adds
 * every user's part up to the bank's amount. Cents are in the bank's sign.
 */
export function explainShare(ctx: AnalysisContext, args: ExplainArgs): Explanation {
  const figure: FigureId = "share.part";
  if (!args.rowId || !args.use) throw new Error("explain: share.part needs a row and the use of its account");
  const t = ctx.txs.find((x) => x.id === args.rowId);
  if (!t) throw new Error("explain: no such row");
  const whole = billCents(t);
  const reasons = args.why?.of(t.id) ?? [];
  if (reasons.some((r) => r.rule === "part.source")) {
    const lines = reasons.map((r, i): Line => ({ id: `${t.id}#${i}`, day: t.bookingDate, cents: r.rule === "part.source" && !r.mine ? 0 : Number(r.cents), whole, why: [r] }));
    return { figure, kind: "share", cents: t.amountCents, lines, check: { kind: "recompute", diffCents: t.amountCents - sumLines(lines) } };
  }
  const lines = args.use.users.map((u): Line => {
    const part = partOf(args.use!, u.userId);
    const cents = partCents(whole, part);
    const rounding: Reason[] = gotTheCent(whole, cents, part) ? [{ rule: "rounding.cent" }] : [];
    return { id: `u:${u.userId ?? "-"}`, day: t.bookingDate, cents, whole, why: [{ rule: "part.use", from: part.from, to: part.to, of: part.of }, ...rounding] };
  });
  const mine = lines.find((l) => l.id === `u:${args.viewerId ?? "-"}`);
  return { figure, kind: "share", cents: mine?.cents ?? 0, lines, check: { kind: "recompute", diffCents: whole - sumLines(lines) } };
}

/**
 * `forecast.month`: what the account is left with after the payments of the window ahead (`cashAhead`: the balance
 * less the bills, subscriptions and transfers it expects). An estimate: the method names its inputs and what it assumes,
 * and there is no check to tick. Null where the window has no balance.
 */
export function explainEstimate(ctx: AnalysisContext, args: ExplainArgs): Explanation {
  const ahead = cashAhead(ctx, args.balances ?? [], args.inputs ?? NO_INPUTS);
  const sources = [...new Set(ahead.rows.map((r) => r.source))].sort().map((s) => `rows.${s}:${ahead.rows.filter((r) => r.source === s).length}`);
  const inputs = [`window:${ahead.from}..${ahead.to}`, `window.reason:${ahead.reason}`, `accounts:${ahead.balance?.accounts ?? 0}`, ...sources];
  const assumptions = ["pay.not_added", "everyday_spending.not_taken_off", "bills.repeat_from_history"];
  return { figure: "forecast.month", kind: "estimate", cents: ahead.balance?.freeCents ?? null, lines: [], method: { kind: "estimate", inputs, assumptions }, check: { kind: "n/a" } };
}
