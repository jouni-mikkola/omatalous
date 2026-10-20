/**
 * What the next regular pay is likely to be, said as an estimate and never as a sum. The facts are the pays that came
 * (`count`, `lowCents`, `highCents`, `usualCents`); the estimate is a range from the 25th to the 75th percentile,
 * `steady` when the pays hardly differ. A pay that varies (commission, shifts, hours) is a range, not the median.
 */
import { monthOf } from "../dates.ts";
import { median } from "../stats.ts";
import type { IsoDate } from "../types.ts";
import { levelStep } from "./income-changes.ts";

/** One regular pay that came: the day it was booked and its sum. */
export interface Pay {
  /** The row, when the caller has one: the basis of an estimate names its pays. */
  id?: string;
  date: IsoDate;
  cents: number;
}

export interface PayEstimate {
  /** How many pays it rests on: the newest twelve after the newest step, at least `MIN_PAYS`. */
  count: number;
  /** The smallest and the largest of those pays: rows that exist. */
  lowCents: number;
  highCents: number;
  /** The median of those pays. */
  usualCents: number;
  /** The estimate's low end: the 25th percentile, rounded down to whole euros. */
  floorCents: number;
  /** The estimate's high end: the 75th percentile, rounded up to whole euros. */
  ceilCents: number;
  kind: "steady" | "varies";
  /** The pay without commission: the level of the smallest pays, with at least `BASE_MIN_PAYS` pays and three of them within `STEADY_SPREAD`. Left out otherwise. */
  baseCents?: number;
  /** The estimate of this pay's month is moved by what the same month paid in earlier years. */
  season?: true;
}

/** Fewer pays than this are no evidence of a level: no estimate. */
const MIN_PAYS = 3;
/** The newest this many pays are the evidence; older ones are another time. */
const MAX_PAYS = 12;
/**
 * A pay whose largest and smallest differ by at most this share of its median is steady. A tax card rounds the
 * withholding by a few euros, so a salary paid in whole months moves by well under 2 %; a commission or a shift moves
 * it by more.
 */
const STEADY_SPREAD = 0.02;
/** A base level needs this many pays, so that the smallest three are not all there is. */
const BASE_MIN_PAYS = 6;
/** A month's pay is above or below its year's median by more than this share: a season, when two years say so. */
const SEASON_SHARE = 0.1;
/** A year's median means something from this many pays. */
const SEASON_YEAR_PAYS = 6;
/** A season needs this many earlier years that agree. */
const SEASON_YEARS = 2;

/** The percentile of sorted values by linear interpolation between the nearest two. */
function percentile(sorted: readonly number[], share: number): number {
  const at = (sorted.length - 1) * share;
  const lo = Math.floor(at);
  const hi = Math.ceil(at);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (at - lo);
}

/**
 * The factor the pay of `due`'s month is moved by, or null. Evidence: the pay of that calendar month in at least two
 * earlier years, each above (or each below) the median of its own year by over 10 %. The factor is the one nearer to 1
 * of the years' ratios, so the move is never larger than the least of what was seen.
 */
function seasonFactor(pays: readonly Pay[], due: IsoDate): number | null {
  const [year, month] = [due.slice(0, 4), due.slice(5, 7)];
  const ratios: number[] = [];
  const years = new Set(pays.map((p) => p.date.slice(0, 4)));
  for (const y of years) {
    if (y >= year) continue;
    const inYear = pays.filter((p) => p.date.startsWith(y));
    const same = inYear.filter((p) => p.date.slice(5, 7) === month);
    if (inYear.length < SEASON_YEAR_PAYS || !same.length) continue;
    ratios.push(median(same.map((p) => p.cents)) / median(inYear.map((p) => p.cents)));
  }
  const above = ratios.filter((r) => r > 1 + SEASON_SHARE);
  const below = ratios.filter((r) => r < 1 - SEASON_SHARE);
  if (above.length >= SEASON_YEARS && below.length < SEASON_YEARS) return Math.min(...above);
  if (below.length >= SEASON_YEARS && above.length < SEASON_YEARS) return Math.max(...below);
  return null;
}

/** The pays that came by `today`, oldest first. */
const cameBy = (pays: readonly Pay[], today: IsoDate): Pay[] => pays.filter((p) => p.date <= today && p.cents > 0).sort((a, b) => a.date.localeCompare(b.date));

/** The newest twelve of the pays that came, after the newest step of their level. */
function evidenceOf(came: readonly Pay[]): Pay[] {
  const step = levelStep(came.map((p) => ({ month: monthOf(p.date), cents: p.cents, date: p.date })));
  return (step ? came.filter((p) => p.date >= step.start.date) : came).slice(-MAX_PAYS);
}

/** The pays an estimate rests on, oldest first; fewer than three when there is no estimate. */
export const payEvidence = (pays: readonly Pay[], today: IsoDate): Pay[] => evidenceOf(cameBy(pays, today));

/**
 * The estimate of a coming pay from the regular pays of its series (`incomeTypes` says regular: holiday pay and other
 * pay are not among them), oldest or newest first alike. The evidence is the newest twelve pays after the newest step
 * `levelStep` finds, since a new tax card or a raise makes older pays no evidence. Under three pays: null, the pay
 * has its day and no sum. `due` is the day of the coming pay, for its season; it is `today` when left out.
 */
export function payEstimate(pays: readonly Pay[], today: IsoDate, due: IsoDate = today): PayEstimate | null {
  const came = cameBy(pays, today);
  const evidence = evidenceOf(came);
  if (evidence.length < MIN_PAYS) return null;

  const sorted = evidence.map((p) => p.cents).sort((a, b) => a - b);
  const usual = median(sorted);
  const [lowCents, highCents] = [sorted[0]!, sorted[sorted.length - 1]!];
  const factor = seasonFactor(came, due);
  const moved = factor ?? 1;
  const base = sorted.length >= BASE_MIN_PAYS && sorted[2]! - sorted[0]! <= sorted[1]! * STEADY_SPREAD;
  return {
    count: sorted.length,
    lowCents,
    highCents,
    usualCents: Math.round(usual * moved),
    floorCents: Math.floor((percentile(sorted, 0.25) * moved) / 100) * 100,
    ceilCents: Math.ceil((percentile(sorted, 0.75) * moved) / 100) * 100,
    kind: highCents - lowCents <= usual * STEADY_SPREAD ? "steady" : "varies",
    ...(base ? { baseCents: lowCents } : {}),
    ...(factor ? { season: true as const } : {}),
  };
}
