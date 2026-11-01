// Decision: whether the household can plan on the next twelve months as they stand, how far the net worth can fall or grow over the years, and so whether to save more or spend less now
import { FORECAST_MONTHS, type ForecastRange, MIN_COMPARE_MONTHS } from "@banking/core";
import { ForecastBand } from "../../../charts/forms/ForecastBand.tsx";
import { QuestionChart, ReportPanel } from "../../../charts/forms/parts.tsx";
import { type Column, Table } from "../../../components/table/Table.tsx";
import { monthLong, roundedMoney as money } from "../../../format.ts";
import { t } from "../../../text.ts";
import type { ReportSection, SectionProps } from "../types.ts";

// One main column per table: a row with two puts both sums on the same line of its block.
const rangeColumns = <R,>(of: (row: R) => ForecastRange | null, prefix: string, head = "", main = true): Column<R>[] => [
  { key: `${prefix}-low`, label: `${head}${t("forecast.col_low")}`, kind: "money", cell: (r) => { const v = of(r); return v ? money(v.lowCents) : "–"; } },
  { key: `${prefix}-mid`, label: `${head}${t("forecast.col_mid")}`, kind: "money", main, cell: (r) => { const v = of(r); return v ? money(v.midCents) : "–"; } },
  { key: `${prefix}-high`, label: `${head}${t("forecast.col_high")}`, kind: "money", cell: (r) => { const v = of(r); return v ? money(v.highCents) : "–"; } },
];

function LongForecast({ ctx }: SectionProps) {
  const r = ctx.data.longForecast;
  if (r.basisMonths === null) {
    return (
      <ReportPanel id={section.id} title={t("forecast.title")}>
        <p>{t("forecast.none", { min: MIN_COMPARE_MONTHS })}</p>
      </ReportPanel>
    );
  }
  const worth = r.netWorthNowCents !== null;
  const year = r.months[FORECAST_MONTHS - 1]!;
  const last = r.months[r.months.length - 1]!;
  const pick = (m: typeof year) => (worth ? m.netWorth! : m.total);
  const answer = t("forecast.answer", { mid: money(year.total.midCents), low: money(year.total.lowCents), high: money(year.total.highCents) }) + (worth ? t("forecast.answer_worth", { mid: money(year.netWorth!.midCents), low: money(year.netWorth!.lowCents), high: money(year.netWorth!.highCents) }) : "");
  const rows = r.months.slice(0, FORECAST_MONTHS);
  const monthTable = (
    <Table<(typeof rows)[number]>
      caption={t("forecast.caption_months")}
      rows={rows}
      rowKey={(m) => m.month}
      search={false}
      columns={[
        { key: "month", label: t("forecast.col_month"), kind: "text", rowHead: true, cell: (m) => monthLong(m.month) },
        ...rangeColumns((m: (typeof rows)[number]) => m.saving, "saving", `${t("forecast.col_saving")}: `, !worth),
        ...(worth ? rangeColumns((m: (typeof rows)[number]) => m.netWorth, "worth", `${t("forecast.col_worth")}: `) : []),
      ]}
    />
  );
  const yearRows = r.years;
  const yearTable = worth && (
    <Table<(typeof yearRows)[number]>
      caption={t("forecast.caption_years")}
      rows={yearRows}
      rowKey={(y) => String(y.year)}
      columns={[{ key: "year", label: t("forecast.col_year"), kind: "text", rowHead: true, cell: (y) => t("forecast.years_ahead", { n: y.year }) }, ...rangeColumns((y: (typeof yearRows)[number]) => y.range, "year")]}
    />
  );
  const range = pick(last);
  return (
    <ReportPanel id={section.id} title={t("forecast.title")}>
      <p>{answer}</p>
      <QuestionChart
        id="forecast-chart"
        question={worth ? t("forecast.chart") : t("forecast.chart_total")}
        answer={t(worth ? "forecast.chart_answer" : "forecast.chart_answer_total", { mid: money(range.midCents), low: money(range.lowCents), high: money(range.highCents) })}
        table={yearTable || undefined}
      >
        <div className="forecast-legend" aria-hidden="true">
          <span className="forecast-key forecast-key-mid">{t("forecast.legend_mid")}</span>
          <span className="forecast-key forecast-key-range">{t("forecast.legend_range")}</span>
        </div>
        <ForecastBand months={r.months} worth={worth} />
      </QuestionChart>
      {monthTable}
      <p className="muted">{t("forecast.basis", { months: r.basisMonths, runs: r.runs })}</p>
    </ReportPanel>
  );
}

export const section: ReportSection = {
  id: "ennuste-vuosi",
  // read when drawn, so the nav follows the member's language
  get title() {
    return t("forecast.title");
  },
  order: 130,
  page: "reports",
  reports: ["longForecast"],
  Component: LongForecast,
};
