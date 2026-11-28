// Decision: which of the two Menot figures to plan with, and why they differ
import type { ReactNode } from "react";
import { answerMoney, signedMoney } from "../../format.ts";
import { type Fact, KeyValue } from "../../components/table/KeyValue.tsx";
import { hashOf } from "../../routes.ts";
import { t } from "../../text.ts";
import type { ReportsData } from "../../types.ts";
import { monthName } from "./month-name.ts";
import type { ReportContext } from "./types.ts";

type FigureParts = ReportsData["figureParts"];
type FigureMonth = FigureParts["categorySpend"]["partialMonths"][number];
type Panel = { label: string; content: ReactNode };

/** The rows of Tapahtumat for some days: the exact filter a part is made of. */
const rowsHref = (from: string, to: string): string => hashOf({ page: "transactions", params: new URLSearchParams({ from, to }) });

const rowsLink = (cents: number, from: string, to: string): ReactNode => <a href={rowsHref(from, to)}>{answerMoney(cents)}</a>;

const monthFact = (m: FigureMonth, complete: boolean, ctx: ReportContext): Fact => [monthName({ month: m.month, complete }, ctx.running), rowsLink(m.cents, m.from, m.to)];

/** What the categories' figure holds beyond the complete months: the months not whole, the debt paid from savings and what no month holds. A line of nothing is left out. */
function beyondCompleteMonths(c: FigureParts["categorySpend"], ctx: ReportContext): Fact[] {
  return [
    ...c.partialMonths.map((m) => monthFact(m, false, ctx)),
    ...(c.fromSavingsCents !== 0 ? [[t("rpt.sm_from_savings"), answerMoney(c.fromSavingsCents)] as const] : []),
    ...(c.otherCents !== 0 ? [[t("rpt.fp_other"), answerMoney(c.otherCents)] as const] : []),
  ];
}

const whyText = (c: FigureParts["categorySpend"]): string => t("rpt.fp_why_text", { months: String(c.monthsInRange), complete: String(c.completeMonths) });

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
        <KeyValue items={[...spend.months.map((m) => monthFact(m, true, ctx)), [t("rpt.fp_total"), answerMoney(spend.cents), "total"]]} />
        {usual && (
          <>
            <p className="fig-pop-heading">{t("rpt.fp_usual", { sum: answerMoney(usual.cents) })}</p>
            <KeyValue items={[[t("rpt.fp_complete_months"), answerMoney(spend.cents)], [t("rpt.fp_large"), signedMoney(-usual.largePurchasesCents)], [t("rpt.fp_divided", { months: String(usual.months) }), answerMoney(usual.cents), "total"]]} />
          </>
        )}
        <p className="fig-pop-heading">{t("rpt.fp_why", { name: t("rpt.page_spending"), sum: answerMoney(c.cents) })}</p>
        <KeyValue items={[[t("rpt.fp_complete_months"), answerMoney(c.completeMonthsCents)], ...beyondCompleteMonths(c, ctx), [t("rpt.tile_spend"), answerMoney(c.cents), "total"]]} />
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
        <KeyValue items={[[t("rpt.fp_complete_months"), answerMoney(c.completeMonthsCents)], ...beyondCompleteMonths(c, ctx), [t("rpt.fp_total"), rowsLink(c.cents, ctx.range.from, ctx.range.to), "total"]]} />
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
