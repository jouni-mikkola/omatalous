import { type AnalysisContext, historyCovers } from "../analysis/context.ts";
import { formatEur } from "../analysis/format.ts";
import { fromMonthIndex, monthIndex } from "../dates.ts";
import { fixedMonthlyCents } from "../recurring.ts";
import type { BalanceInput } from "./balances.ts";

/** Months of income the share is averaged over, at most. */
const INCOME_MONTHS = 6;
const MIN_INCOME_MONTHS = 3;
/** A buffer of three months of fixed costs is the usual advice. */
const TARGET_MONTHS = 3;
/** Less than this is not a household's fixed costs, only a few subscriptions. */
const MIN_FIXED_CENTS = 20000;

export interface BufferReport {
  /** Subscriptions, bills and loan instalments per month, as they are now. */
  fixedMonthlyCents: number;
  /** Average income of the latest whole months; null with fewer than three. */
  incomeMonthlyCents: number | null;
  /** Fixed costs as a share of that income. */
  fixedShare: number | null;
  /** Balances of savings accounts today; null when no savings account has a balance. */
  savingsCents: number | null;
  /** The savings in months of fixed costs. */
  bufferMonths: number | null;
  /** What it means and what to do; "" when there is nothing to say. */
  advice: string;
}

/**
 * How much of the income is spoken for before the month starts, and how
 * long the savings would carry those costs. Always about today. Quiet
 * without fixed costs, and the buffer is told only where the bank gave a
 * savings balance (a CSV import has none).
 */
export function bufferReport(ctx: AnalysisContext, balances: readonly BalanceInput[]): BufferReport {
  const fixed = fixedMonthlyCents(ctx.recurring);
  const none: BufferReport = { fixedMonthlyCents: fixed, incomeMonthlyCents: null, fixedShare: null, savingsCents: null, bufferMonths: null, advice: "" };
  if (fixed < MIN_FIXED_CENTS) return none;

  // the whole months before this one that the history covers, newest first
  const months: number[] = [];
  for (let m = monthIndex(ctx.today.slice(0, 7)) - 1; months.length < INCOME_MONTHS && historyCovers(ctx, `${fromMonthIndex(m)}-01`); m--) months.push(m);
  const set = new Set(months);
  const income = new Map<number, number>();
  for (const t of ctx.txs) if (set.has(t.month) && t.flows.income) income.set(t.month, (income.get(t.month) ?? 0) + t.flows.income);
  const incomeMonthly = months.length >= MIN_INCOME_MONTHS ? Math.round(months.reduce((s, m) => s + (income.get(m) ?? 0), 0) / months.length) : null;
  const share = incomeMonthly && incomeMonthly > 0 ? fixed / incomeMonthly : null;

  const savings = balances.filter((a) => a.type === "savings" && a.balanceCents !== null);
  const savingsCents = savings.length ? savings.reduce((s, a) => s + a.balanceCents!, 0) : null;
  const bufferMonths = savingsCents === null ? null : Math.max(0, savingsCents) / fixed;

  const report = { fixedMonthlyCents: fixed, incomeMonthlyCents: incomeMonthly, fixedShare: share, savingsCents, bufferMonths };
  return { ...report, advice: advice(report) };
}

const months = (n: number) => n.toFixed(1).replace(".", ",");

function advice(r: Omit<BufferReport, "advice">): string {
  const parts: string[] = [];
  if (r.fixedShare !== null && r.incomeMonthlyCents !== null) {
    const free = r.incomeMonthlyCents - r.fixedMonthlyCents;
    parts.push(
      `Kiinteät menot ${formatEur(r.fixedMonthlyCents, false)} kuukaudessa vievät ${Math.round(r.fixedShare * 100)} % tuloista. ` +
        (r.fixedShare >= 0.6
          ? `Vapaaksi jää ${formatEur(Math.max(0, free), false)}, joten tulojen pieneneminen osuisi suoraan ruokaan ja muihin arjen menoihin. Uusia pitkiä sitoumuksia kannattaa välttää.`
          : `Vapaaksi jää ${formatEur(Math.max(0, free), false)} arkeen ja säästöön.`),
    );
  }
  if (r.bufferMonths !== null && r.savingsCents !== null) {
    const target = TARGET_MONTHS * r.fixedMonthlyCents;
    parts.push(
      r.bufferMonths >= TARGET_MONTHS
        ? `Säästötileillä on ${formatEur(r.savingsCents, false)}, joka kattaa kiinteät menot ${months(r.bufferMonths)} kuukaudeksi. Puskuri on riittävä.`
        : `Säästötileillä on ${formatEur(r.savingsCents, false)}, joka kattaa kiinteät menot ${months(r.bufferMonths)} kuukaudeksi. Kolmen kuukauden puskuri olisi ${formatEur(target, false)}, jolloin puuttuu ${formatEur(target - r.savingsCents, false)}.`,
    );
  }
  return parts.join(" ");
}
