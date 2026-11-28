// Decision: which of the two Menot figures to plan with, and why they differ
import type { ReactNode } from "react";
import { answerMoney, rowMoney } from "../../format.ts";
import { type Fact, KeyValue } from "../../components/table/KeyValue.tsx";
import { hashOf } from "../../routes.ts";
import { t } from "../../text.ts";
import type { ReportsData } from "../../types.ts";
import { monthName } from "./month-name.ts";
import type { ReportContext } from "./types.ts";

type FigureParts = ReportsData["figureParts"];
type FigureMonth = FigureParts["categorySpend"]["partialMonths"][number];
type Panel = { label: string; content: ReactNode };

// The rows are to the cent (`rowMoney`) so that they add up to the total the panel shows; only the headings, which are sentences, are in whole euros.

/** Tapahtumat for the days of a part. It has no filter for spending, so the list also holds income and transfers of those days and need not add up to the sum linked. */
const rowsHref = (from: string, to: string): string => hashOf({ page: "transactions", params: new URLSearchParams({ from, to }) });

const rowsLink = (cents: number, from: string, to: string): ReactNode => <a href={rowsHref(from, to)}>{rowMoney(cents)}</a>;

const monthFact = (m: FigureMonth, complete: boolean, ctx: ReportContext): Fact => [monthName({ month: m.month, complete }, ctx.running), rowsLink(m.cents, m.from, m.to)];

/** The complete months' row of a bridge: left out when they are nothing, as no month has ended. */
const completeFact = (cents: number): Fact[] => (cents !== 0 ? [[t("rpt.fp_complete_months"), rowMoney(cents)]] : []);

/** What the categories' figure holds beyond the complete months: the months not whole, the debt paid from savings and what no month holds. A line of nothing is left out. */
function beyondCompleteMonths(c: FigureParts["categorySpend"], ctx: ReportContext): Fact[] {
  return [
    ...c.partialMonths.map((m) => monthFact(m, false, ctx)),
    ...(c.fromSavingsCents !== 0 ? [[t("rpt.sm_from_savings"), rowMoney(c.fromSavingsCents)] as const] : []),
    ...(c.otherCents !== 0 ? [[t("rpt.fp_other"), rowMoney(c.otherCents)] as const] : []),
  ];
}

/** Why the two figures differ; the clause of the debt paid from savings only when there is some. */
const whyText = (c: FigureParts["categorySpend"]): string =>
  t(c.fromSavingsCents !== 0 ? "rpt.fp_why_text" : "rpt.fp_why_text_plain", { months: String(c.monthsInRange), complete: String(c.completeMonths) });

/** The panel of Menot on Tulot ja menot: the complete months it adds up, the usual month made of them, and the bridge to Menot kategorioittain. */
export function cashflowSpendPanel(ctx: ReportContext): Panel | undefined {
  const parts = ctx.data.figureParts;
  const spend = parts?.cashflowSpend;
  if (!parts || !spend) return undefined;
  const c = parts.categorySpend;
  const usual = spend.usual;
  return {
    label: t("rpt.fp_cash_title"),
    content: (
      <>
        <KeyValue items={[...spend.months.map((m) => monthFact(m, true, ctx)), [t("rpt.fp_total"), rowMoney(spend.cents), "total"]]} />
        {usual && (
          <>
            <p className="fig-pop-heading">{t("rpt.fp_usual", { sum: answerMoney(usual.cents) })}</p>
            <KeyValue items={[[t("rpt.fp_complete_months"), rowMoney(spend.cents)], ...(usual.largePurchasesCents !== 0 ? [[t("rpt.fp_large"), rowMoney(-usual.largePurchasesCents)] as const] : []), [t("rpt.fp_divided", { months: String(usual.months) }), rowMoney(usual.cents), "total"]]} />
          </>
        )}
        <p className="fig-pop-heading">{t("rpt.fp_why", { name: t("rpt.page_spending"), sum: answerMoney(c.cents) })}</p>
        <KeyValue items={[...completeFact(c.completeMonthsCents), ...beyondCompleteMonths(c, ctx), [t("rpt.tile_spend"), rowMoney(c.cents), "total"]]} />
        <p className="fig-pop-text">{whyText(c)}</p>
      </>
    ),
  };
}

/** The panel of Kaikki menot on Menot kategorioittain: the parts of the whole period and the bridge to the Menot of Tulot ja menot. */
export function categorySpendPanel(ctx: ReportContext): Panel | undefined {
  const parts = ctx.data.figureParts;
  if (!parts) return undefined;
  const c = parts.categorySpend;
  return {
    label: t("rpt.tile_spend"),
    content: (
      <>
        <KeyValue items={[...completeFact(c.completeMonthsCents), ...beyondCompleteMonths(c, ctx), [t("rpt.fp_total"), rowsLink(c.cents, ctx.range.from, ctx.range.to), "total"]]} />
        {parts.cashflowSpend && (
          <>
            <p className="fig-pop-heading">{t("rpt.fp_why", { name: t("rpt.page_income"), sum: answerMoney(parts.cashflowSpend.cents) })}</p>
            <p className="fig-pop-text">{whyText(c)}</p>
          </>
        )}
      </>
    ),
  };
}
