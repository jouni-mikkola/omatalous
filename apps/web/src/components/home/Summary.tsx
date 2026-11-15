// Decision: how the month stands: what came in, what went out, what is left of it, and where the income went
import { bridgeView, MIN_COMPARE_MONTHS, type BridgeView } from "@banking/core";
import { css } from "../../css.ts";
import { answerMoney, completeMonths, dateRange, monthLong, percent } from "../../format.ts";
import { t } from "../../text.ts";
import type { DashboardData } from "../../types.ts";
import { Figure } from "../Figure.tsx";
import { percentBetween, percentOf } from "./shared.ts";

type Data = DashboardData & { nyt: NonNullable<DashboardData["nyt"]> };
type Tone = "income" | "spending" | "kept" | "debt" | "neutral";

/**
 * The month's spending against its usual level to the same day, else last month's to the same day, else that the history
 * is short. A comparison that waits for a card's earlier purchases says nothing: the household cannot mend it here.
 */
function spentLine(data: Data): string | null {
  const usual = data.home.pace;
  if (usual) {
    const diff = answerMoney(Math.abs(usual.diffCents));
    if (usual.position === "above") return t("home.tile_spent_above", { sum: diff });
    if (usual.position === "below") return t("home.tile_spent_below", { sum: diff });
    return t("home.tile_spent_within", { sum: answerMoney(usual.expectedCents) });
  }
  const previous = data.pace.previous;
  // a shorter month before is read to its last day: its sum is the whole month's, and the line says so
  if (previous) return t(previous.day < data.nyt.pace.day ? "home.tile_spent_previous_whole" : "home.fig_previous", { sum: answerMoney(previous.toToday) });
  if (data.home.paceGap === "history") return t("home.tile_gap_history", { months: completeMonths(MIN_COMPARE_MONTHS) });
  return null;
}

/** A figure's bar: its length against the scale it shares with its comparison, and the comparison as a mark or a band. */
interface Gauge {
  cents: number;
  scaleCents: number;
  tone: Tone;
  /** The same figure a month before to the same day, or the usual level's band, on the bar's scale. */
  markCents: number | null;
  band: { lowCents: number; highCents: number } | null;
}

function Bar({ gauge }: { gauge: Gauge }) {
  const { cents, scaleCents, tone, markCents, band } = gauge;
  return (
    <span className="home-gauge" data-tone={tone} aria-hidden="true">
      <span className="home-gauge-fill" ref={css({ "inline-size": percentOf(Math.abs(cents), scaleCents) })} />
      {band && <span className="home-band" ref={css({ "inset-inline-start": percentOf(band.lowCents, scaleCents), "inline-size": percentBetween(band.lowCents, band.highCents, scaleCents) })} />}
      {markCents !== null && <span className="home-gauge-mark" ref={css({ "inset-inline-start": percentOf(Math.abs(markCents), scaleCents) })} />}
    </span>
  );
}

const scaleOf = (...cents: (number | null)[]) => Math.max(1, ...cents.map((c) => Math.abs(c ?? 0)));

interface Item {
  id: "income" | "spent" | "result";
  label: string;
  cents: number;
  gauge: Gauge;
  line: string | null;
  /** A second line under the first: the part of the income that is earned. */
  extra?: string;
}

function itemsOf(data: Data): Item[] {
  const { totals, previousTotals, comparable, overview, home } = data;
  // the figures are the ones the chart of the months draws (Tulot, Menot of the running month), so the page tells one sum for each
  const incomeCents = overview.income.cents;
  const spentCents = overview.months.at(-1)?.spendCents ?? data.nyt.pace.spentCents;
  const compared = comparable && data.running;
  const sameDay = (cents: number) => (compared ? cents : null);
  const previousLine = (cents: number | null) => (cents === null ? null : t("home.fig_previous", { sum: answerMoney(cents) }));
  const previousIncome = sameDay(previousTotals.incomeCents);
  const previousResult = sameDay(previousTotals.leftCents);
  const pace = home.pace;
  const previousSpent = data.pace.previous?.toToday ?? null;
  const spentMark = pace ? null : previousSpent;
  const earned = overview.income.earnedCents;
  return [
    {
      id: "income",
      label: t("home.fig_income"),
      cents: incomeCents,
      gauge: { cents: incomeCents, scaleCents: scaleOf(incomeCents, previousIncome), tone: "income", markCents: previousIncome, band: null },
      line: previousLine(previousIncome),
      extra: earned !== overview.income.cents ? t("home.tile_income_earned", { sum: answerMoney(earned) }) : undefined,
    },
    {
      id: "spent",
      label: t("home.fig_spent"),
      cents: spentCents,
      gauge: {
        cents: spentCents,
        scaleCents: scaleOf(spentCents, spentMark, pace?.highCents ?? null),
        tone: "spending",
        markCents: spentMark,
        band: pace ? { lowCents: pace.lowCents, highCents: pace.highCents } : null,
      },
      line: spentLine(data),
    },
    {
      id: "result",
      label: t("home.fig_result"),
      cents: totals.leftCents,
      gauge: { cents: totals.leftCents, scaleCents: scaleOf(totals.leftCents, previousResult), tone: totals.leftCents < 0 ? "debt" : "income", markCents: previousResult, band: null },
      line: previousLine(previousResult),
    },
  ];
}

/** The tone of each part of the bar: the role colour the same part has in every chart. */
const FLOW_TONE: Record<string, Tone> = { consumption: "spending", debt: "debt", saved: "kept", repaid: "neutral", left: "income", credit: "neutral", savings: "neutral", accounts: "neutral" };

function flowLabel(key: string): string {
  switch (key) {
    case "consumption": return t("home.bridge_consumption");
    case "debt": return t("home.bridge_debt");
    case "saved": return t("home.bridge_saved");
    case "repaid": return t("home.bridge_repaid");
    case "credit": return t("home.bridge_credit");
    case "savings": return t("home.bridge_savings");
    case "accounts": return t("home.bridge_accounts");
    default: return t("home.fig_result");
  }
}

/**
 * Tulojen käyttö: the bar of where the month's income went, in the order of the flows (consumption, debt, savings, what
 * stayed), and under it each part with its sum and its share of the income. All of it is `bridgeView` of the same totals
 * as the three figures above, the one calculation of the bridge on Raportit, so the parts add up to the figures. With no
 * income, or a part below zero, the bar is not drawn and the parts stand as a list alone.
 */
function Flow({ view }: { view: BridgeView }) {
  const rows = view.figures.filter((f) => f.key !== "income" && f.cents !== 0);
  return (
    <section className="home-flow" aria-labelledby="home-flow-h">
      <h3 id="home-flow-h">{t("home.bridge_where")}</h3>
      {view.draws && (
        <span className="home-flow-bar" aria-hidden="true">
          {view.parts.filter((p) => p.share > 0).map((p) => (
            <span key={p.key} data-tone={FLOW_TONE[p.key] ?? "neutral"} ref={css({ "flex-grow": p.share })} />
          ))}
        </span>
      )}
      <ul className="home-flow-list">
        {rows.map((f) => (
          <li key={f.key} data-part={f.key}>
            <span className="home-flow-swatch" data-tone={FLOW_TONE[f.key] ?? "neutral"} aria-hidden="true" />
            <span className="home-flow-name">{flowLabel(f.key)}</span>
            <span className="home-flow-share num">{f.incomeUnits !== null ? percent(f.incomeUnits / 100) : ""}</span>
            <span className="home-flow-sum num">{answerMoney(f.cents)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The month and its year with the first letter up: "Marraskuu 2026". */
const monthHeading = (month: string) => monthLong(month).replace(/^./u, (c) => c.toLocaleUpperCase());

/**
 * The top of Yhteenveto: one period named once (the month and the days it has run), then Tulot, Menot and Tulos in the
 * order the money moves, Tulos the largest, each with its comparison drawn on its own bar: a mark at the same day of last
 * month, and for Menot the band of the usual level to this day when the history gives one. Below them the use of the
 * income (Flow). The figures are `totals` of the dashboard answer, the same period and the same calculation the bridge
 * has, so nothing is added up here. The payday figure belongs to the bills (Bills), which it is made of.
 */
export function Summary({ data, today }: { data: Data; today: string }) {
  const to = today < data.range.to ? today : data.range.to;
  const month = data.range.from.slice(0, 7);
  const items = itemsOf(data);
  return (
    <section className="home-summary" aria-labelledby="home-summary-h">
      <div className="home-period">
        <h2 id="home-summary-h">{monthHeading(month)}</h2>
        <span className="home-range num">{dateRange(data.range.from, to, today)}</span>
      </div>
      <ul className="home-figs">
        {items.map((item) => (
          <li key={item.id} data-fig={item.id} className={item.id === "result" && item.cents < 0 ? "home-short" : undefined}>
            <span className="home-fig-label">{item.label}</span>
            <Figure text={answerMoney(item.cents)} size={item.id === "result" ? "l" : "m"} />
            <Bar gauge={item.gauge} />
            {item.line && <span className="home-fig-line">{item.line}</span>}
            {item.extra && <span className="home-fig-line">{item.extra}</span>}
          </li>
        ))}
      </ul>
      <Flow view={bridgeView(data.totals)} />
    </section>
  );
}
