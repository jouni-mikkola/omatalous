// Decision: how the month stands: what came in, what went out, what is left of it, and where the income went
import { bridgeView, localeOf, MIN_COMPARE_MONTHS, monthEnd, previousRange, type BridgeView } from "@banking/core";
import { css } from "../../css.ts";
import { answerMoney, completeMonths, dateRange, language, monthLong, percent } from "../../format.ts";
import { t } from "../../text.ts";
import type { DashboardData } from "../../types.ts";
import { Figure } from "../Figure.tsx";

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

interface Item {
  id: "income" | "spent" | "result";
  label: string;
  cents: number;
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
  const { totals, previousTotals, comparable, overview } = data;
  // the figures are the ones the chart of the months draws (Tulot, Menot of the running month), so the page tells one sum for each
  const incomeCents = overview.income.cents;
  const spentCents = overview.months.at(-1)?.spendCents ?? data.nyt.pace.spentCents;
  const compared = comparable && data.running;
  const sameDay = (cents: number) => (compared ? cents : null);
  const previousLine = (cents: number | null) => (cents === null ? null : t(previousWords(data, today), { sum: answerMoney(cents) }));
  const previousIncome = sameDay(previousTotals.incomeCents);
  const previousResult = sameDay(previousTotals.leftCents);
  const earned = overview.income.earnedCents;
  return [
    {
      id: "income",
      label: t("home.fig_income"),
      cents: incomeCents,
      line: previousLine(previousIncome),
      extra: earned !== overview.income.cents ? t("home.tile_income_earned", { sum: answerMoney(earned) }) : undefined,
    },
    {
      id: "spent",
      label: t("home.fig_spent"),
      cents: spentCents,
      line: spentLine(data, today),
    },
    {
      id: "result",
      label: t("home.fig_result"),
      cents: totals.leftCents,
      line: previousLine(previousResult),
      terms: termsOf(totals),
    },
  ];
}

/** The tone of each part of the bar: the role colour the same part has in every chart. */
const COVER_KEYS: readonly string[] = ["credit", "savings", "accounts"];

/**
 * The spending over the income and what paid it, in one sentence (the parts use the words of Raportit's `rpt.gap_credit`, `rpt.gap_savings` and `rpt.gap_accounts`), or null when the income
 * paid everything. The gap and its parts are `cover` of the bridge: the sums of the sources bar. The page tells one sum for
 * what was taken out of savings or drawn on credit, the one under Käteen jäi (`shown`): when savings alone covered the gap the
 * sentence names no sum for them, and otherwise it names that sum, not the part of it that went to the gap.
 */
function gapSentence(view: BridgeView, shown: { saved: number; credit: number }): string | null {
  const { cover } = view;
  if (cover.gapCents < 50) return null;
  const savingsOnly = cover.savingsCents >= 50 && cover.creditCents < 50 && cover.accountsCents < 50;
  const drawnSavings = shown.saved < 0 ? -shown.saved : cover.savingsCents;
  const drawnCredit = shown.credit > 0 ? shown.credit : cover.creditCents;
  const parts = [
    cover.creditCents >= 50 ? t("rpt.gap_credit", { sum: answerMoney(drawnCredit) }) : null,
    cover.savingsCents >= 50 && !savingsOnly ? t("rpt.gap_savings", { sum: answerMoney(drawnSavings) }) : null,
    cover.accountsCents >= 50 ? t("rpt.gap_accounts", { sum: answerMoney(cover.accountsCents) }) : null,
  ].filter((p): p is string => p !== null);
  // money moved to savings or credit paid back is no spending: the lead then says transfers too
  // Käteen jäi counts the money drawn as well, so beside a gap it is told what it is, not left to read against the gap
  const left = t("home.gap_left");
  const lead = t(view.totals.savedCents > 0 || cover.creditRepaidCents > 0 ? "home.gap_lead_transfers" : "home.gap_lead", { sum: answerMoney(cover.gapCents) });
  if (savingsOnly) return `${lead} ${t("home.gap_from_savings")} ${left}`;
  if (parts.length === 0) return `${lead} ${left}`;
  const covered = `${lead} ${t("home.gap_cover", { parts: new Intl.ListFormat(localeOf(language()), { type: "conjunction" }).format(parts) })}`;
  // credit that covered the gap can leave money over: Käteen jäi is then above 0 beside a gap, and the line says what it is
  return view.totals.leftCents > 0 ? `${covered} ${left}` : covered;
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
    case "income": return t("home.fig_income");
    case "credit": return t("home.source_credit");
    case "savings": return t("home.source_savings");
    case "accounts": return t("home.source_accounts");
    default: return t("home.fig_result");
  }
}

/** The parts of the bar of what came in (Tuli); every other part is on the bar of what went out (Meni). */
const IN_KEYS: readonly string[] = ["income", "credit-left", "savings-left", ...COVER_KEYS];

type BridgeFigureOf = BridgeView["figures"][number];
type BridgePiecesOf = BridgeView["parts"];

/** One bar with its name at the left and its parts named under it. */
function FlowSide({ side, name, pieces, figures, view, euros }: { side: "in" | "out"; name: string; pieces: BridgePiecesOf; figures: BridgeFigureOf[]; view: BridgeView; euros: Record<string, number> }) {
  const sharesShown = view.cover.gapCents < 50;
  return (
    <div className="home-flow-side" data-side={side}>
      <span className="home-flow-side-name">{name}</span>
      <span className="home-flow-bar" data-bar={side} aria-hidden="true">
        {pieces.filter((p) => p.share > 0).map((p) => (
          <span key={p.key} data-part={p.key} data-tone={FLOW_TONE[p.key] ?? "neutral"} ref={css({ "flex-grow": p.share })} />
        ))}
      </span>
      <FlowList figures={figures} view={view} euros={euros} sharesShown={sharesShown} side={side} />
    </div>
  );
}

/** The parts under a bar (or alone): the name, the share of the income and the sum, which a part that is a figure of the strip does not have. */
function FlowList({ figures, view, euros, sharesShown, side }: { figures: BridgeFigureOf[]; view: BridgeView; euros: Record<string, number>; sharesShown: boolean; side: "in" | "out" | "all" }) {
  return (
    <ul className="home-flow-list" data-side={side}>
      {figures.map((f) => (
        <li key={f.key} data-part={f.key}>
          <span className="home-flow-swatch" data-tone={FLOW_TONE[f.key] ?? "neutral"} aria-hidden="true" />
          <span className="home-flow-name">{flowLabel(f.key, view.debtSplit)}</span>
          <span className="home-flow-share num">{sharesShown && f.incomeUnits !== null ? percent(f.incomeUnits / 100) : ""}</span>
          <span className="home-flow-sum num">{f.key === "left" || IN_KEYS.includes(f.key) || f.key in euros ? "" : answerMoney(f.cents)}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Tulojen käyttö: two bars on one scale, Tuli (the income, and what covered the rest: credit, savings, the accounts) and Meni
 * (consumption, debt, savings, what stayed), each with its parts named under it. A part that is already a figure of the
 * month's strip (Tulot, Käteen jäi, and the terms under it: savings moved or taken out, credit drawn or paid back) is named
 * without its sum, so each sum stands once; the sums of what covered a gap are told in the one sentence under the bars, and
 * with a gap the parts have no share column, as shares of the income alone would add to more than 100 %. All of it is
 * `bridgeView` of the same totals as the three figures above, the one calculation of the bridge on Raportit. With no income,
 * or a part below zero, no bar is drawn and the parts stand as a list alone.
 */
function Flow({ view, shown }: { view: BridgeView; shown: { saved: number; credit: number } }) {
  // a part named like a term under Tulos stands only where its term is shown, and it has no sum of its own: the term tells it
  const euros: Record<string, number> = { saved: shown.saved, "savings-left": -shown.saved, "credit-left": shown.credit, repaid: -shown.credit };
  const figures = view.figures.filter((f) => f.cents !== 0 && (!(f.key in euros) || euros[f.key]! > 0));
  const gap = gapSentence(view, shown);
  // the income alone is the bar of what came in when it paid everything
  const came = view.sources.length > 0 ? view.sources : [{ key: "income" as const, cents: view.totals.incomeCents, share: 1 }];
  return (
    <section className="home-flow" aria-labelledby="home-flow-h">
      <h3 id="home-flow-h">{t("home.bridge_where")}</h3>
      {view.draws ? (
        <>
          <FlowSide side="in" name={t("home.bridge_in")} pieces={came} figures={figures.filter((f) => IN_KEYS.includes(f.key))} view={view} euros={euros} />
          <FlowSide side="out" name={t("home.bridge_out")} pieces={view.parts} figures={figures.filter((f) => !IN_KEYS.includes(f.key))} view={view} euros={euros} />
        </>
      ) : (
        <FlowList figures={figures.filter((f) => f.key !== "income" && !COVER_KEYS.includes(f.key))} view={view} euros={euros} sharesShown={view.cover.gapCents < 50} side="all" />
      )}
      {gap && <p className="home-detail" data-part="gap">{gap}</p>}
    </section>
  );
}

/** The month and its year with the first letter up: "Marraskuu 2026". */
const monthHeading = (month: string) => monthLong(month).replace(/^./u, (c) => c.toLocaleUpperCase());

/**
 * The top of Yhteenveto: one period named once (the month and the days it has run), then Tulot, Menot and Tulos in the
 * order the money moves, each with its comparison as a line: the same day of last month, and for Menot the usual level to this
 * day when the history gives one. Below them the use of the
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
            <Figure text={answerMoney(item.cents)} size="l" />
            <span className="home-fig-notes">
              {item.terms?.map((term) => <span key={term} className="home-fig-term">{term}</span>)}
              {item.line && <span className="home-fig-line">{item.line}</span>}
              {item.extra && <span className="home-fig-line">{item.extra}</span>}
            </span>
          </li>
        ))}
      </ul>
      <Flow view={bridgeView(data.totals, data.split)} shown={shownTerms(data.totals)} />
    </section>
  );
}
