/**
 * The answer of `GET /api/transactions`: the rows of the accounts in view as the bank booked them, in both views. In the
 * own view a row of a joint account carries the viewer's part beside its amount (`partCents`), and `inCents` and
 * `outCents` add up parts. A row has the category and the transfer mark the view counts it by, so the list, its sums
 * and the front page say the same of it.
 */
import { moneyBins, partCents } from "@banking/core";
import { extensionRowFields } from "../extensions.ts";
import { parseDateRange } from "../platform/validate.ts";
import { parseScope, rowsInView } from "./analysis.ts";
import type { Services } from "./context.ts";
import { ownRulesOfRows, publicTx } from "./rules.ts";

// the strip's histogram bins at most the last hundred years of a span (1 201 month bins, about 70 kB): no household's bank
// rows reach that far, and a span of 1900 to 2199 would be 3 600 bins (210 kB) on every load of the list
const HISTOGRAM_YEARS = 100;
const histogramFrom = (span: { from: string; to: string }): string => {
  const first = `${String(Number(span.to.slice(0, 4)) - HISTOGRAM_YEARS).padStart(4, "0")}-${span.to.slice(5, 7)}-01`;
  return span.from > first ? span.from : first;
};

/** The query of the list, as the route reads it: strings by name, and `limit` and `offset` already read as numbers. */
export interface TransactionsQuery {
  from?: string;
  to?: string;
  accountId?: string;
  category?: string;
  kind?: string;
  merchant?: string;
  q?: string;
  sums?: string;
  scope?: string;
  limit?: number;
  offset?: number;
}

export async function transactionsView(s: Services, userId: string, q: TransactionsQuery) {
  const repo = s.finance(userId);
  const range = parseDateRange(q.from || undefined, q.to || undefined);
  const { shared, own } = await rowsInView(s, userId, parseScope(q.scope));
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
  const { total, inCents, outCents, days, items: stored } = await repo.listTransactions(filter, shared.map((a) => a.id));
  // the list grouped by payee (`sums=merchant`): each listed payee's whole sums, as each listed day has its own
  const merchantSums = q.sums === "merchant" ? await repo.merchantSums(filter, shared.map((a) => a.id), [...new Set(stored.map((t) => t.merchant))]) : undefined;
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
    inCents,
    outCents,
    netCents: inCents - outCents,
    span,
    // the totals strip's histogram and each listed day's whole sums
    histogram: span ? moneyBins(days, histogramFrom(span), span.to) : null,
    daySums: days.filter((d) => onPage.has(d.date)),
    ...(merchantSums ? { merchantSums } : {}),
    items: items.map((t) => {
      const part = own.parts.get(t.accountId);
      const share = own.shares?.get(t.id);
      return {
        ...publicTx(t),
        own: t.userId === userId,
        ...(share ? { partCents: share.cents, ...(share.openCents !== 0 ? { openCents: share.openCents } : {}) } : part ? { partCents: partCents(t.amountCents, part) } : {}),
        ...(industry.has(t.merchant) && t.categorySource === "industry" ? { industry: industry.get(t.merchant) } : {}),
        ...(ownRules.has(t.id) ? { ownRule: ownRules.get(t.id) } : {}),
        ...extra.get(t.id),
      };
    }),
  };
}
