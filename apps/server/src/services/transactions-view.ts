/**
 * The answer of `GET /api/transactions`: the rows of the accounts in view as the bank booked them, in both views. In the
 * own view a row of a joint account carries the viewer's part beside its amount (`partCents`). The sums are the flows
 * of the rows as the front page adds them up, and null while the context is older than the rows. A row has the category
 * and the transfer mark the view counts it by, so the list, its sums and the front page say the same of it. A payment
 * that arrived short carries its fee as its part.
 */
import { type AnalysisContext, type AnalysisTx, type Flows, loweredRows, moneyBins, partCents, totalsOf } from "@banking/core";
import { extensionRowFields } from "../extensions.ts";
import { parseDateRange } from "../platform/validate.ts";
import { parseScope, rowsInView } from "./analysis.ts";
import type { Services } from "./context.ts";
import { memoOn } from "./context-memo.ts";
import { ownRulesOfRows, publicTx } from "./rules.ts";

// the strip's histogram bins at most the last hundred years of a span (1 201 month bins, about 70 kB): no household's bank
// rows reach that far, and a span of 1900 to 2199 would be 3 600 bins (210 kB) on every load of the list
const HISTOGRAM_YEARS = 100;
const histogramFrom = (span: { from: string; to: string }): string => {
  const first = `${String(Number(span.to.slice(0, 4)) - HISTOGRAM_YEARS).padStart(4, "0")}-${span.to.slice(5, 7)}-01`;
  return span.from > first ? span.from : first;
};

// the rows of the context by id, built once for the context and shared with the review queue, which keeps the same map under this name
const rowsOf = (ctx: AnalysisContext) => memoOn(ctx, "review:rows-by-id", null, () => new Map(ctx.txs.map((t) => [t.id, t])));

/** The query of the list, as the route reads it: strings by name, and `limit` and `offset` already read as numbers. */
export interface TransactionsQuery {
  from?: string;
  to?: string;
  accountId?: string;
  category?: string;
  kind?: string;
  merchant?: string;
  q?: string;
  scope?: string;
  limit?: number;
  offset?: number;
}

export async function transactionsView(s: Services, userId: string, q: TransactionsQuery) {
  const repo = s.finance(userId);
  const range = parseDateRange(q.from || undefined, q.to || undefined);
  const { shared, own, ctx } = await rowsInView(s, userId, parseScope(q.scope));
  const filter = {
    from: range.from,
    to: range.to,
    accountId: q.accountId,
    category: q.category,
    kind: q.kind === "income" ? ("income" as const) : undefined,
    merchant: q.merchant,
    q: q.q?.slice(0, 100),
    limit: q.limit,
    offset: q.offset,
    own,
  };
  const { total, ids, days: counts, items: stored } = await repo.listTransactions(filter, shared.map((a) => a.id));
  // the strip's figures, the histogram's bars and each day's sums are the flows of the matching rows, as the front page adds
  // them up: a refund lowers Menot, a loan account's row and a move between own accounts are neutral, what lands on savings
  // is saved, a short payment's fee is spent, and a card bill whose statement is read stands at what its rows leave of it
  // beside those rows on their own days (`spendRows`; the rows stand beside it only when no filter narrows the list)
  const rowsById = rowsOf(ctx);
  const listed: AnalysisTx[] = [];
  // a row the view cuts to nothing has no row in the context and counts nothing; any other row missing belongs to a newer read
  // than the context the sums come from, and no figure is told then
  let updating = false;
  for (const id of ids) {
    const row = rowsById.get(id);
    if (row) listed.push(row);
    else if (own.shares?.get(id)?.cents !== 0) updating = true;
  }
  const narrowed = !!(q.accountId || q.category || q.kind === "income" || q.merchant || q.q?.trim());
  const explained = narrowed ? [] : ctx.explained.filter((t) => (!range.from || t.bookingDate >= range.from) && (!range.to || t.bookingDate <= range.to));
  // a narrowed list holds only the rows it names: its bill stays whole, as its row says, and the purchases it paid are not its rows
  const counted = narrowed ? listed : [...loweredRows(ctx, listed), ...explained];
  const flowsOfDay = new Map<string, Flows[]>();
  for (const t of counted) flowsOfDay.set(t.bookingDate, [...(flowsOfDay.get(t.bookingDate) ?? []), t.flows]);
  const countOfDay = new Map(counts.map((d) => [d.date, d.count]));
  const days = [...new Set([...countOfDay.keys(), ...flowsOfDay.keys()])].sort().map((date) => {
    const { incomeCents, expenseCents, savedCents } = totalsOf(flowsOfDay.get(date) ?? []);
    return { date, count: countOfDay.get(date) ?? 0, inCents: incomeCents, outCents: expenseCents, savedCents };
  });
  const { incomeCents: inCents, expenseCents: outCents, savedCents } = totalsOf(counted.map((t) => t.flows));
  const items = stored.map((t) => ({ ...t, ...own.told.get(t.id) }));
  // which company and industry an "industry" category came from, shown on hover; a shared row's category came from its
  // owner's lookups, so the owners' requests count too. The extensions' fields and the viewer's own rule a row's category
  // came from (named by the row's detail) read the rows only, so the three run together.
  const [industry, extra, ownRules] = await Promise.all([
    repo.industryDetails(
      items.filter((t) => t.categorySource === "industry").map((t) => t.merchant),
      shared.map((a) => a.userId),
    ),
    extensionRowFields(s, userId, items.filter((t) => t.userId === userId)),
    ownRulesOfRows(s, userId, items),
  ]);
  // the period the sums cover: the filter's, or from the first to the last matching row
  const span = days.length ? { from: range.from ?? days[0]!.date, to: range.to ?? days[days.length - 1]!.date } : null;
  const onPage = new Set(items.map((t) => t.bookingDate));
  return {
    total,
    inCents: updating ? null : inCents,
    outCents: updating ? null : outCents,
    netCents: updating ? null : inCents - outCents,
    // what the rows move onto savings accounts or into savings categories (negative: taken out); Tulos is netCents less this
    // (and plus the credit the rows draw, which no row of an ordinary month holds)
    savedCents: updating ? null : savedCents,
    span,
    // the totals strip's histogram and each listed day's whole sums
    histogram: span && !updating ? moneyBins(days, histogramFrom(span), span.to) : null,
    daySums: updating ? [] : days.filter((d) => onPage.has(d.date)),
    items: items.map((t) => {
      const part = own.parts.get(t.accountId);
      const share = own.shares?.get(t.id);
      const fee = own.fees?.get(t.id);
      return {
        ...publicTx(t),
        own: t.userId === userId,
        // a payment that arrived short is listed whole, as a transfer, and counts as its fee: the figure the row's part shows
        ...(fee ? { partCents: -fee } : share ? { partCents: share.cents, ...(share.openCents !== 0 ? { openCents: share.openCents } : {}) } : part ? { partCents: partCents(t.amountCents, part) } : {}),
        ...(industry.has(t.merchant) && t.categorySource === "industry" ? { industry: industry.get(t.merchant) } : {}),
        ...(ownRules.has(t.id) ? { ownRule: ownRules.get(t.id) } : {}),
        ...extra.get(t.id),
      };
    }),
  };
}
