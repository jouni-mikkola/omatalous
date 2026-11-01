/**
 * The household's small purchases as a whole: purchases under 10 € (`SMALL_PURCHASE_CENTS`, the habit alert's own
 * line) in the last six complete months against the same six months a year earlier, so no season reads as a change.
 * The habit alert and Pienet tavat tell one payee each; a coffee here and a kiosk there add up with no payee of their
 * own standing out. Bills and subscriptions, payments to people and cash are left out. Told in both directions when
 * the sums moved 30 % or more, the months stand apart from their month-to-month noise (`meansApart`, ADR 0011) and the
 * change is worth the gate over a year. All 18 months must be complete, and every account that paid a small purchase
 * in them must cover both windows: a card connected later would read as a rise.
 */
import { addMonths, monthEnd, monthIndex } from "../../dates.ts";
import { SMALL_PURCHASE_CENTS } from "../alerts.ts";
import { netPurchase, paidToPerson } from "../context.ts";
import { accountCovers } from "../coverage.ts";
import { formatEur } from "../format.ts";
import { meansApart } from "../signal.ts";
import { isCompleteMonth } from "../usual.ts";
import { MAX_SMALL_ROWS, MIN_SMALL_CHANGE, TOP_PAYEES } from "../../thresholds.ts";
import { insightOf, lastCompleteMonths } from "./shared.ts";
import { messageIn } from "../../messages.ts";
import { type Insight, type InsightArgs, q } from "./types.ts";

const MONTHS = 6;
const NOT_SMALL_PURCHASE: ReadonlySet<string> = new Set(["p2p", "cash"]);

export function smallPurchases({ ctx, end, gateMonthlyCents, lang }: InsightArgs): Insight[] {
  const now = lastCompleteMonths(ctx, end, MONTHS);
  if (now.length < MONTHS) return [];
  const then = now.map((m) => addMonths(m, -12));
  for (let m = then[0]!; m < now[0]!; m = addMonths(m, 1)) if (!isCompleteMonth(ctx, m)) return [];
  const bills = new Set(ctx.recurring.filter((s) => s.kind === "bill" || s.kind === "subscription").flatMap((s) => s.transactionIds));
  const slot = new Map<number, { window: "now" | "then"; i: number }>([
    ...now.map((m, i) => [monthIndex(m), { window: "now" as const, i }] as const),
    ...then.map((m, i) => [monthIndex(m), { window: "then" as const, i }] as const),
  ]);
  const sums = { now: now.map(() => 0), then: then.map(() => 0) };
  const counts = { now: 0, then: 0 };
  const accounts = new Set<string>();
  const byPayee = new Map<string, number>();
  const rows: string[] = [];
  for (const t of ctx.txs) {
    const at = slot.get(t.month);
    if (!at || t.isTransfer || paidToPerson(t) || NOT_SMALL_PURCHASE.has(t.category) || bills.has(t.id) || ctx.fixedIds.has(t.id)) continue;
    const cents = netPurchase(t);
    if (cents <= 0 || cents >= SMALL_PURCHASE_CENTS) continue;
    sums[at.window][at.i]! += cents;
    counts[at.window] += 1;
    accounts.add(t.accountId);
    if (at.window === "now") {
      byPayee.set(t.merchant, (byPayee.get(t.merchant) ?? 0) + cents);
      rows.push(t.id);
    }
  }
  if (!accounts.size || !accountCovers(ctx, accounts, `${then[0]}-01`)) return [];
  const a = sums.now.reduce((s, v) => s + v, 0);
  const b = sums.then.reduce((s, v) => s + v, 0);
  if (a <= 0 || b <= 0) return [];
  const yearly = Math.round((Math.abs(a - b) * 12) / MONTHS);
  if (Math.abs(a / b - 1) < MIN_SMALL_CHANGE || yearly < 12 * gateMonthlyCents || !meansApart(sums.now, sums.then)) return [];
  const monthlyNow = Math.round(a / MONTHS);
  const monthlyThen = Math.round(b / MONTHS);
  const perMonthNow = Math.round(counts.now / MONTHS);
  const perMonthThen = Math.round(counts.then / MONTHS);
  const top = [...byPayee].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0])).slice(0, TOP_PAYEES).map(([m]) => m);
  const small = formatEur(SMALL_PURCHASE_CENTS, false, lang);
  const up = a > b;
  return [
    insightOf({
      lang,
      id: "small-purchases",
      fact: { type: "small-purchases", monthlyCents: monthlyNow, perMonth: perMonthNow, top, limitCents: SMALL_PURCHASE_CENTS, up },
      comparison: { label: "yearAgo", value: q.cents(monthlyThen) },
      action: { label: "seeRows", target: { page: "transactions", filter: { from: `${now[0]}-01`, to: monthEnd(now[MONTHS - 1]!) } } },
      yearlyCents: up ? -yearly : yearly,
      kind: "pattern",
      rows: rows.slice(-MAX_SMALL_ROWS),
      link: { from: `${now[0]}-01`, to: monthEnd(now[MONTHS - 1]!) },
      calc: [
        { label: messageIn(lang, "calc.limit"), value: small },
        { label: messageIn(lang, "calc.purchases_month_now"), value: String(perMonthNow) },
        { label: messageIn(lang, "calc.purchases_month_then"), value: String(perMonthThen) },
        { label: messageIn(lang, "calc.month_now"), value: formatEur(monthlyNow, false, lang) },
        { label: messageIn(lang, "calc.month_then"), value: formatEur(monthlyThen, false, lang) },
      ],
    }),
  ];
}
