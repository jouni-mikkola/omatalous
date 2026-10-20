/**
 * Noise budget: a detector that compares two windows fires on at most 1 % of 200 steady households, where nothing
 * changed but chance. Odd seeds draw Poisson visits, even ones over-dispersed visits and heavy-tailed tickets
 * (noise.ts), each judged on a day of October drawn apart from the model. A detector over the budget today is in known.ts with the number of
 * households it fires on; that number may only go down, and the entry goes when the detector is within the budget.
 */
import { describe, expect, it } from "vitest";
import { type Statement, statements } from "../../../../tools/findings/statements.ts";
import { rng } from "../gen.ts";
import { steadyHousehold } from "./household.ts";
import { KNOWN_NOISE } from "./known.ts";

const SEEDS = 200;
/** 1 % of the households. */
const BUDGET = SEEDS / 100;
const CHUNK = 10;

/**
 * The detectors that set one window against another: price rises, stops, new subscriptions, year and season
 * comparisons, spending and habit changes, income changes, the change sentences, Optimoi's rises and habits, and a
 * follow-up's verdict. Not the ones about a level or an event (a renewal, instalments, a double charge, a fee).
 */
const TWO_WINDOW: readonly RegExp[] = [
  /^insights (price|price-rises|stopped|new|seasons|spending-[a-z_]+|commitments-share|income|subscriptions-added)$/,
  /^alerts (spike|habit)$/,
  /^optimise [a-z]+:(rise|eating_out|delivery|repeat|month)$/,
  /^income (?!windfall)[a-z_]+$/,
  /^change (usual|season|year)$/,
  /^outcome [a-zä]+$/,
];

/** A source and its kind: an insight's id up to the first colon (`spending-groceries`, `spending-growth`), an alert's kind. */
function detectorOf(s: Statement): string {
  return `${s.source} ${s.kind}`;
}

/** A day of October 2026 for the seed, drawn apart from the noise model so every day meets both models. */
function dayOf(seed: number): string {
  return `2026-10-${String(1 + Math.floor(rng(seed * 104_729 + 17)() * 31)).padStart(2, "0")}`;
}

describe("the noise budget", () => {
  const fired = new Map<string, number>();

  it.each(Array.from({ length: SEEDS / CHUNK }, (_, i) => i * CHUNK + 1))("steady households from seed %i", (first) => {
    for (let seed = first; seed < first + CHUNK; seed++) {
      const h = steadyHousehold(seed, seed % 2 ? "poisson" : "overdispersed", dayOf(seed));
      const detectors = new Set(statements(h).filter((s) => s.loud).map(detectorOf));
      for (const d of detectors) if (TWO_WINDOW.some((re) => re.test(d))) fired.set(d, (fired.get(d) ?? 0) + 1);
    }
  }, 60_000);

  it("each two-window detector fires on at most 1 % of them, or as known.ts says", () => {
    const over = Object.fromEntries([...fired].filter(([, n]) => n > BUDGET).sort(([a], [b]) => a.localeCompare(b)));
    expect(over).toEqual(Object.fromEntries(KNOWN_NOISE.map((k) => [k.detector, k.households])));
  });
});
