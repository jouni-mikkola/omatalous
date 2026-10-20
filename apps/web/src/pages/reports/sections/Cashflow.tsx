// Decision: spend less or save more
import { DataTable } from "../../../components/table/DataTable.tsx";
import { coverOf, monthEnd, monthOf, monthRange } from "@banking/core";
import { query } from "../../../api.ts";
import type { CashflowReport, YearToDate } from "@banking/core";
import { CumulativeYears, CumulativeYearsTable } from "../../../charts/forms/CumulativeYears.tsx";
import { IncomeUse, IncomeUseTable } from "../../../charts/forms/IncomeUse.tsx";
import { QuestionChart, ReportPanel } from "../../../charts/forms/parts.tsx";
import { RateBand, rateRange, rateStaysUsual } from "../../../charts/forms/RateBand.tsx";
import { unknownPercent } from "../../../components/UnknownShare.tsx";
import { Why } from "../../../components/Why.tsx";
import { money, monthLong, percent, plural } from "../../../format.ts";
import { ExportLink, Kv } from "../parts.tsx";
import type { ReportSection, SectionProps } from "../types.ts";

/** Money in nothing has told yet is no earned income until answered: over the limit, one line says so beside the spending's. */
export function UnknownIncome({ share, range }: { share: number; range: SectionProps["ctx"]["range"] }) {
  const percent = unknownPercent(share);
  if (percent === null) return null;
  return (
    <p className="question-line">
      Tuloista {percent} % on vielä tunnistamatta, eikä sitä lasketa ansaituiksi tuloiksi ennen kuin kerrot, mitä se on.{" "}
      <a href={`#/transactions${query({ category: "income", from: range.from, to: range.to })}`}>Näytä tapahtumat</a>
    </p>
  );
}

/** "syyskuu" → "Syyskuu". */
const capital = (s: string) => `${s[0]!.toUpperCase()}${s.slice(1)}`;
/** The month name of "2026-09", "syyskuu". */
const nameOf = (month: string) => monthLong(month).split(" ")[0] ?? month;

/**
 * The answer under the cumulative chart: where this year stands and the server's like-for-like gap to last year. The
 * figure opens its rows from 1 January; while its month runs it is an estimate (VT5's mark).
 */
function ytdAnswer(y: YearToDate, scope: SectionProps["ctx"]["scope"]) {
  const last = y.current.findLastIndex((v) => v !== null);
  if (last < 0) return "Tältä vuodelta ei ole vielä valmista tammikuuta.";
  const month = `${y.year}-${String(last + 1).padStart(2, "0")}`;
  const figure = money(y.current[last]!, false);
  const now = (
    <>
      Yli jäi 1.1. alkaen{" "}
      <strong>
        <Why figure="yli_jai.month" title="Yli jäi 1.1. alkaen" range={{ from: `${y.year}-01-01`, to: monthEnd(month) }} scope={scope} text={figure} estimate={last === y.partialMonth ? "approx" : undefined}>
          {figure}
        </Why>
      </strong>
      {last === y.partialMonth ? `, ${nameOf(month)} kesken` : ""}.
    </>
  );
  if (!y.compared) return now;
  const at = nameOf(`${y.year}-${String(y.compared.month + 1).padStart(2, "0")}`);
  return (
    <>
      {now} {capital(at)}n loppuun se on <strong>{money(Math.abs(y.compared.cents), false)}</strong> {y.compared.cents >= 0 ? "enemmän" : "vähemmän"} kuin vuotta aiemmin.
    </>
  );
}

/** The answer about the savings rate: the newest complete month against the usual band, both as printed. */
function rateAnswer(r: CashflowReport, flat: boolean) {
  const last = r.rows.findLast((x) => x.complete && x.savingsRate !== null);
  if (!last) return "Säästöastetta varten tarvitaan valmis kuukausi.";
  const u = r.usualRate;
  if (flat && u) return <>Säästöön meni joka kuukausi tavallinen osuus tuloista, {rateRange(u).replace("tavallisesti ", "")} ({u.months} kuukautta).</>;
  const rate = Math.round(last.savingsRate! * 100);
  const where = !u ? "" : rate < Math.round(u.low * 100) ? ", tavallista vähemmän" : rate > Math.round(u.high * 100) ? ", tavallista enemmän" : ", tavallisella tasolla";
  return (
    <>
      {capital(nameOf(last.month))}ssa säästöön meni <strong>{percent(last.savingsRate!)}</strong> tuloista{where}.{u ? ` ${capital(rateRange(u))} (${u.months} kuukautta).` : ""}
    </>
  );
}

/** The rate chart's table view. */
function RateTable({ rows }: { rows: CashflowReport["rows"] }) {
  return (
    <DataTable
      id="saastoaste"
      caption="Säästöaste kuukausittain"
      rows={rows}
      rowKey={(x) => x.month}
      columns={[
        { key: "month", label: "Kuukausi", kind: "text", rowHead: true, cell: (x) => monthLong(x.month) },
        { key: "rate", label: "Säästöaste", kind: "share", main: true, cell: (x) => (x.complete && x.savingsRate !== null ? percent(x.savingsRate) : "–"), sortValue: (x) => (x.complete ? x.savingsRate : null) },
      ]}
    />
  );
}

/** The answer under the income-use table: the period's flows, each a server total. */
function useAnswer(t: NonNullable<CashflowReport["settled"]>) {
  return (
    <>
      Tuloja tuli <strong>{money(t.incomeCents, false)}</strong>. Kulutukseen meni {money(t.consumptionCents, false)}, velanhoitoon {money(t.debtCents, false)} ja säästöön {money(t.savedCents, false)}. Yli jäi <strong>{money(t.leftCents, false)}</strong>.
    </>
  );
}

function Cashflow({ ctx }: SectionProps) {
  const r = ctx.data.cashflow;
  const t = r.totals;
  const drawn = coverOf(t).creditDrawnCents;
  const settled = r.settled;
  // the months the period's figures are of: the complete ones when the range holds the running month
  const complete = r.rows.filter((x) => x.complete).length;
  const shown = monthRange(monthOf(ctx.range.from), monthOf(ctx.range.to)).length === r.rows.length;
  const n = r.running ? r.closedMonths : shown ? r.rows.length : complete;
  const span = r.running ? plural(n, "valmiissa kuukaudessa", "valmiissa kuukaudessa") : plural(n, "kuukaudessa", "kuukaudessa");
  const totalLabel = r.running ? plural(n, "valmis kuukausi", "valmista kuukautta") : plural(n, "kuukausi", "kuukautta");
  const flat = rateStaysUsual(r.rows, r.usualRate);
  const rate = (
    <QuestionChart id="kassavirta-aste" question="Pysyykö säästöaste tavallisella tasolla?" answer={rateAnswer(r, flat)} table={<RateTable rows={r.rows} />}>
      {!flat && <RateBand rows={r.rows} usual={r.usualRate} />}
    </QuestionChart>
  );
  return (
    <ReportPanel id={section.id} title={section.title} datum={settled ? `Yli jäi ${money(settled.leftCents, false)}` : undefined} actions={<ExportLink href={ctx.exportHref("cashflow")} />}>
      <UnknownIncome share={r.unknownIncomeShare} range={ctx.range} />
      {/* a running range with no complete month has no settled figures: the totals stand in their place */}
      {!settled && (
        <Kv
          items={[
            ["Tulot", money(t.incomeCents, false)],
            ["Menot", money(t.expenseCents, false)],
            ["Säästöön", money(t.savedCents, false)],
            ...(drawn > 0 ? ([["Luotonnostot", money(drawn, false)]] as [string, string][]) : []),
          ]}
        />
      )}
      <QuestionChart id="kassavirta-kaytto" question={`Mihin tulot menivät ${span}?`} answer={settled ? useAnswer(settled) : "Jaksolla ei ole vielä valmista kuukautta."} table={<IncomeUseTable rows={r.rows} total={settled} totalLabel={totalLabel} />}>
        <IncomeUse rows={r.rows} total={settled} totalLabel={totalLabel} />
      </QuestionChart>
      <hr className="qc-rule" />
      {flat ? (
        <>
          <QuestionChart id="kassavirta-ytd" question="Jääkö tänä vuonna enemmän yli kuin viime vuonna?" answer={ytdAnswer(r.yearToDate, ctx.scope)} table={<CumulativeYearsTable ytd={r.yearToDate} scope={ctx.scope} />}>
            <CumulativeYears ytd={r.yearToDate} />
          </QuestionChart>
          <hr className="qc-rule" />
          {rate}
        </>
      ) : (
        <div className="qc-pair">
          <QuestionChart id="kassavirta-ytd" question="Jääkö tänä vuonna enemmän yli kuin viime vuonna?" answer={ytdAnswer(r.yearToDate, ctx.scope)} table={<CumulativeYearsTable ytd={r.yearToDate} scope={ctx.scope} />}>
            <CumulativeYears ytd={r.yearToDate} />
          </QuestionChart>
          {rate}
        </div>
      )}
    </ReportPanel>
  );
}

export const section: ReportSection = {
  id: "kassavirta",
  title: "Tulot ja menot",
  order: 20,
  page: "reports",
  tab: "virta",
  reports: ["cashflow"],
  Component: Cashflow,
};
