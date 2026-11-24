// Decision: how the month stands: what came in, what went out, what is left of it, and where the income went
import { bridgeView, localeOf, MIN_COMPARE_MONTHS, monthEnd, previousRange, type BridgeView } from "@banking/core";
import { css } from "../../css.ts";
import { answerMoney, completeMonths, dateRange, language, monthLong, percent } from "../../format.ts";
import { t } from "../../text.ts";
import type { DashboardData } from "../../types.ts";
import { Figure } from "../Figure.tsx";
import { percentBetween, percentOf } from "./shared.ts";

type Data = DashboardData & { nyt: NonNullable<DashboardData["nyt"]> };
type Tone = "income" | "spending" | "kept" | "debt" | "neutral";

/**
 * The words of the month before's figure, one rule for Tulot, Menot and Tulos: "to the same day", or "all of last month"
 * when the window it is read in is the whole month, which is when it ends on another day of the month than today's (the
 * month before is shorter, as 31.10. against September, or today is the month's last day, as 30.4. against all of March).
 * The window is the one the server read (`previousRange`). A month that is over is read whole against the whole month before,
 * also when both end on the same day (August against July).
 */
function previousWords(data: Data, today: string): "home.fig_previous" | "home.tile_spent_previous_whole" {
  const end = data.running ? today : data.range.to;
  if (!data.running && end === monthEnd(end.slice(0, 7))) return "home.tile_spent_previous_whole";
  const [, previousTo] = previousRange(data.range.from, end);
  return previousTo.slice(8) === end.slice(8) ? "home.fig_previous" : "home.tile_spent_previous_whole";
}

/**
 * The month's spending against its usual level to the same day, else last month's to the same day, else that the history
 * is short. A comparison that waits for a card's earlier purchases says nothing: the household cannot mend it here.
 */
function spentLine(data: Data, today: string): string | null {
  const usual = data.home.pace;
  if (usual) {
    const diff = answerMoney(Math.abs(usual.diffCents));
    if (usual.position === "above") return t("home.tile_spent_above", { sum: diff });
    if (usual.position === "below") return t("home.tile_spent_below", { sum: diff });
    return t("home.tile_spent_within", { sum: answerMoney(usual.expectedCents) });
  }
  const previous = data.pace.previous;
  if (previous) return t(previousWords(data, today), { sum: answerMoney(previous.toToday) });
  if (data.home.paceGap === "history") return t("home.tile_gap_history", { months: completeMonths(MIN_COMPARE_MONTHS) });
  return null;
}

/**
 * A figure's bar: its length against the scale all three figures share, and the comparison as a mark or a band. A figure
 * below zero fills from the far end of the bar, so a shortfall never looks like the same sum kept.
 */
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
  const deficit = cents < 0;
  return (
    <span className="home-gauge" data-tone={tone} aria-hidden="true">
      <span className="home-gauge-fill" data-deficit={deficit || undefined} ref={css({ "inline-size": percentOf(Math.abs(cents), scaleCents) })} />
      {band && <span className="home-band" ref={css({ "inset-inline-start": percentOf(band.lowCents, scaleCents), "inline-size": percentBetween(band.lowCents, band.highCents, scaleCents) })} />}
      {markCents !== null && <span className="home-gauge-mark" data-deficit={deficit || undefined} ref={css({ [deficit ? "inset-inline-end" : "inset-inline-start"]: percentOf(Math.abs(markCents), scaleCents) })} />}
    </span>
  );
}

/** The longest of the sums the bars draw, with their comparisons: one scale for Tulot, Menot and Tulos. */
const scaleOf = (...cents: (number | null)[]) => Math.max(1, ...cents.map((c) => Math.abs(c ?? 0)));

/** The comparison of a figure, or null when it is on the other side of zero: a mark of a shortfall on a bar of a surplus says nothing. */
const sameSign = (cents: number, comparison: number | null) => (comparison !== null && (cents < 0) === (comparison < 0) ? comparison : null);

interface Item {
  id: "income" | "spent" | "result";
  label: string;
  cents: number;
  gauge: Gauge;
  line: string | null;
  /** A second line under the first: the part of the income that is earned. */
  extra?: string;
  /** The terms between Menot and Tulos that are not spending: what moved to or from savings and what credit drew or took back. */
  terms?: string[];
}

/**
 * What Tulot less Menot leaves out of Tulos: money moved to savings (less), taken out of them (more), credit drawn (more) or
 * paid back (less). Each is a sum of `totals`, told with its direction and rounded to its own euro, so a term is the same
 * sum wherever the page tells it. The terms as shown can differ from Tulos as shown by a euro: each figure is rounded alone.
 */
function termsOf(totals: Data["totals"]): string[] {
  const { saved, credit } = shownTerms(totals);
  const line = (key: "home.term_saved" | "home.term_savings_drawn" | "home.term_credit_drawn" | "home.term_credit_repaid", cents: number) => (cents === 0 ? [] : [t(key, { sum: answerMoney(Math.abs(cents)) })]);
  return [...line(saved >= 0 ? "home.term_saved" : "home.term_savings_drawn", saved), ...line(credit >= 0 ? "home.term_credit_drawn" : "home.term_credit_repaid", credit)];
}

/**
 * What moved to savings (negative: taken out) and what was drawn on credit (negative: paid back) as the whole euros the page
 * shows: each is its own sum to the euro, and the same words in Tulojen käyttö show the same euros. A sum under 50 cents is no term.
 */
function shownTerms(totals: Data["totals"]): { saved: number; credit: number } {
  const euros = (cents: number) => (Math.abs(cents) >= 50 ? Math.sign(cents) * Math.round(Math.abs(cents) / 100) * 100 : 0);
  return { saved: euros(totals.savedCents), credit: euros(totals.borrowedCents) };
}

function itemsOf(data: Data, today: string): Item[] {
  const { totals, previousTotals, comparable, overview, home } = data;
  // the figures are the ones the chart of the months draws (Tulot, Menot of the running month), so the page tells one sum for each
  const incomeCents = overview.income.cents;
  const spentCents = overview.months.at(-1)?.spendCents ?? data.nyt.pace.spentCents;
  const compared = comparable && data.running;
  const sameDay = (cents: number) => (compared ? cents : null);
  const previousLine = (cents: number | null) => (cents === null ? null : t(previousWords(data, today), { sum: answerMoney(cents) }));
  const previousIncome = sameDay(previousTotals.incomeCents);
  const previousResult = sameDay(previousTotals.leftCents);
  const pace = home.pace;
  const previousSpent = data.pace.previous?.toToday ?? null;
  const spentMark = pace ? null : previousSpent;
  const earned = overview.income.earnedCents;
  const scaleCents = scaleOf(incomeCents, spentCents, totals.leftCents, previousIncome, previousResult, spentMark, pace?.highCents ?? null);
  return [
    {
      id: "income",
      label: t("home.fig_income"),
      cents: incomeCents,
      gauge: { cents: incomeCents, scaleCents, tone: "income", markCents: previousIncome, band: null },
      line: previousLine(previousIncome),
      extra: earned !== overview.income.cents ? t("home.tile_income_earned", { sum: answerMoney(earned) }) : undefined,
    },
    {
      id: "spent",
      label: t("home.fig_spent"),
      cents: spentCents,
      gauge: {
        cents: spentCents,
        scaleCents,
        tone: "spending",
        markCents: spentMark,
        band: pace ? { lowCents: pace.lowCents, highCents: pace.highCents } : null,
      },
      line: spentLine(data, today),
    },
    {
      id: "result",
      label: t("home.fig_result"),
      cents: totals.leftCents,
      gauge: { cents: totals.leftCents, scaleCents, tone: totals.leftCents < 0 ? "debt" : "income", markCents: sameSign(totals.leftCents, previousResult), band: null },
      line: previousLine(previousResult),
      terms: termsOf(totals),
    },
  ];
}

/** The tone of each part of the bar: the role colour the same part has in every chart. */
const COVER_KEYS: readonly string[] = ["credit", "savings", "accounts"];

/**
 * The spending over the income and what paid it, in one sentence (the words of Raportit's `rpt.gap_*`), or null when the income
 * paid everything. The gap and its parts are `cover` of the bridge: the sums of the sources bar.
 */
function gapSentence(view: BridgeView): string | null {
  const { cover } = view;
  if (cover.gapCents < 50) return null;
  const parts = [
    cover.creditCents >= 50 ? t("rpt.gap_credit", { sum: answerMoney(cover.creditCents) }) : null,
    cover.savingsCents >= 50 ? t("rpt.gap_savings", { sum: answerMoney(cover.savingsCents) }) : null,
    cover.accountsCents >= 50 ? t("rpt.gap_accounts", { sum: answerMoney(cover.accountsCents) }) : null,
  ].filter((p): p is string => p !== null);
  // money moved to savings or credit paid back is no spending: the lead then says transfers too
  const lead = t(view.totals.savedCents > 0 || cover.creditRepaidCents > 0 ? "home.gap_lead_transfers" : "home.gap_lead", { sum: answerMoney(cover.gapCents) });
  return parts.length === 0 ? lead : `${lead} ${t("rpt.gap_cover", { parts: new Intl.ListFormat(localeOf(language()), { type: "conjunction" }).format(parts) })}`;
}

const FLOW_TONE: Record<string, Tone> = { income: "income", consumption: "spending", interest: "debt", debt: "debt", principal: "debt", subtotal: "neutral", saved: "kept", repaid: "neutral", left: "income", credit: "neutral", savings: "neutral", accounts: "neutral" };

/** The debt service is told whole (*Maksettu velanhoito*) or, beside its interest and repayments, as what no evidence splits. */
function flowLabel(key: string, split: boolean): string {
  switch (key) {
    case "consumption": return t("home.bridge_consumption");
    case "debt": return t(split ? "home.bridge_unsplit" : "home.bridge_debt");
    case "interest": return t("home.bridge_interest");
    case "subtotal": return t("home.bridge_subtotal");
    case "principal": return t("home.bridge_principal");
    case "saved": return t("home.bridge_saved");
    case "repaid": return t("home.bridge_repaid");
    case "savings-left": return t("home.bridge_savings_left");
    case "credit-left": return t("home.bridge_credit_left");
    default: return t("home.fig_result");
  }
}

/**
 * Tulojen käyttö: the bar of where the month's income went, in the order of the flows (consumption, debt, savings, what
 * stayed), and under it each part with its sum and its share of the income. All of it is `bridgeView` of the same totals
 * as the three figures above, the one calculation of the bridge on Raportit, so the parts add up to the figures. When
 * the spending was more than the income, a second bar above the first draws what paid for it: the income, then the credit,
 * the savings and the accounts that covered the rest, told in one sentence under the list: the spending over the income and
 * what paid it, so the shares of the list, which add to more than 100 %, are not read as an error. With no income, or a part
 * below zero, no bar is drawn and the parts stand as a list alone.
 */
function Flow({ view, shown }: { view: BridgeView; shown: { saved: number; credit: number } }) {
  // a part named like a term under Tulos shows the euros that term shows, and no row stands where its term is not shown
  const euros: Record<string, number> = { saved: shown.saved, "savings-left": -shown.saved, "credit-left": shown.credit, repaid: -shown.credit };
  const rows = view.figures
    .filter((f) => f.key !== "income" && !COVER_KEYS.includes(f.key) && f.cents !== 0 && (!(f.key in euros) || euros[f.key]! > 0))
    .map((f) => ({ ...f, cents: f.key in euros ? euros[f.key]! : f.cents }));
  const gap = gapSentence(view);
  return (
    <section className="home-flow" aria-labelledby="home-flow-h">
      <h3 id="home-flow-h">{t("home.bridge_where")}</h3>
      {view.draws && view.sources.length > 0 && (
        <span className="home-flow-bar" data-bar="sources" aria-hidden="true">
          {view.sources.filter((p) => p.share > 0).map((p) => (
            <span key={p.key} data-part={p.key} data-tone={FLOW_TONE[p.key] ?? "neutral"} ref={css({ "flex-grow": p.share })} />
          ))}
        </span>
      )}
      {view.draws && (
        <span className="home-flow-bar" data-bar="parts" aria-hidden="true">
          {view.parts.filter((p) => p.share > 0).map((p) => (
            <span key={p.key} data-part={p.key} data-tone={FLOW_TONE[p.key] ?? "neutral"} ref={css({ "flex-grow": p.share })} />
          ))}
        </span>
      )}
      <ul className="home-flow-list">
        {rows.map((f) => (
          <li key={f.key} data-part={f.key}>
            <span className="home-flow-swatch" data-tone={FLOW_TONE[f.key] ?? "neutral"} aria-hidden="true" />
            <span className="home-flow-name">{flowLabel(f.key, view.debtSplit)}</span>
            <span className="home-flow-share num">{f.incomeUnits !== null ? percent(f.incomeUnits / 100) : ""}</span>
            <span className="home-flow-sum num">{answerMoney(f.cents)}</span>
          </li>
        ))}
      </ul>
      {gap && <p className="home-detail" data-part="gap">{gap}</p>}
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
  const items = itemsOf(data, today);
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
            {item.terms?.map((term) => <span key={term} className="home-fig-term">{term}</span>)}
            {item.line && <span className="home-fig-line">{item.line}</span>}
            {item.extra && <span className="home-fig-line">{item.extra}</span>}
          </li>
        ))}
      </ul>
      <Flow view={bridgeView(data.totals, data.split)} shown={shownTerms(data.totals)} />
    </section>
  );
}
