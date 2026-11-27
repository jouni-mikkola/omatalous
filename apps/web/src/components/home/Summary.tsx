// Decision: how the month stands: what came in, what went out and what is left of it
import { MIN_COMPARE_MONTHS, monthEnd, previousRange } from "@banking/core";
import { answerMoney, completeMonths, dateRange, monthLong } from "../../format.ts";
import { spentLabel, t } from "../../text.ts";
import type { DashboardData } from "../../types.ts";
import { Figure } from "../Figure.tsx";

type Data = DashboardData & { nyt: NonNullable<DashboardData["nyt"]> };

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
 * shows: each is its own sum to the euro. A sum under 50 cents is no term.
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
      label: spentLabel(Boolean(overview.months.at(-1)?.fromSavingsCents)),
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

/** The month and its year with the first letter up: "Marraskuu 2026". */
const monthHeading = (month: string) => monthLong(month).replace(/^./u, (c) => c.toLocaleUpperCase());

/**
 * The top of Yhteenveto: one period named once (the month and the days it has run), then Tulot, Menot and Tulos in the
 * order the money moves, each with its comparison as a line: the same day of last month, and for Menot the usual level to this
 * day when the history gives one. The figures are `totals` of the dashboard answer, so nothing is added up here. The payday figure belongs to the bills (Bills), which it is made of.
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
            <Figure text={answerMoney(item.cents)} size="s" />
            <span className="home-fig-notes">
              {item.terms?.map((term) => <span key={term} className="home-fig-term">{term}</span>)}
              {item.line && <span className="home-fig-line">{item.line}</span>}
              {item.extra && <span className="home-fig-line">{item.extra}</span>}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
