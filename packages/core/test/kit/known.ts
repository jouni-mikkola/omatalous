/**
 * The false findings the kit shows today, the baseline of metamorphic.test.ts and noise.test.ts. It may only shrink:
 * an entry that no longer occurs fails its test, so a fixed finding cannot come back unseen. 0.9.0's H3, H4, H6 and H8
 * fix entries; a new false finding is fixed in its own task, never added here.
 */

/**
 * A statement an event makes that its file does not allow: `<source> <statement id>`, and the wrong cause it names
 * (the allow rule in index.ts: a real amount is allowed, a wrong cause is not).
 */
export interface KnownEventStatement {
  event: string;
  statement: string;
  why: string;
}

const USUAL = "change change:usual:2026-10..2026-10";
const SEASON = "change change:season:2026-10..2026-10";
const YEAR = "change change:year:2025-10..2026-09";

/** The usual total is the median of six months' totals: a step or a one-off in some of them moves it while each category's median stays. */
const MEDIAN = "the gap comes from the median of the six months' totals, and the sentence names the base household's own category noise as its causes";

export const KNOWN_EVENT_STATEMENTS: readonly KnownEventStatement[] = [
  { event: "move-same-landlord", statement: USUAL, why: `October reads dearer than usual although its rent equals the last four months': two of the six months still have the old rent, so ${MEDIAN}` },
  { event: "move-same-landlord", statement: YEAR, why: "a new contract for a dearer flat called a dearer purchase (kalliimpi ostoskerta)" },
  { event: "cadence-quarterly-to-monthly", statement: USUAL, why: "names fuel and delivery purchases left out (ostot jääneet pois): base noise the quarterly insurance in October used to offset" },
  { event: "mobilepay-person", statement: SEASON, why: "weekly pay to a babysitter called a one-off (kertaosto)" },
  { event: "sync-lag", statement: SEASON, why: "card rows not synced yet called purchases left out (ostot jääneet pois)" },
  { event: "sync-lag", statement: USUAL, why: "card rows not synced yet called purchases left out (ostot jääneet pois)" },
  { event: "stopped-account", statement: SEASON, why: "rows of a card that stopped syncing called purchases left out (ostot jääneet pois)" },
  { event: "stopped-account", statement: USUAL, why: "rows of a card that stopped syncing called purchases left out (ostot jääneet pois)" },
  { event: "stopped-account", statement: YEAR, why: "rows of a card that stopped syncing called fewer visits (harvemmin)" },
  { event: "early-repayment", statement: YEAR, why: "a mortgage prepayment called a one-off purchase (kertaosto) on consumer credit (Kulutusluotot)" },
  { event: "holiday-abroad", statement: USUAL, why: `October reads cheaper than usual after a July trip: ${MEDIAN}` },
  { event: "large-purchase", statement: USUAL, why: `October reads cheaper than usual after a television in September: ${MEDIAN}` },
];

/** A detector that fires on more steady households than the noise budget allows, with how many of the 200 it fires on. */
export interface KnownNoise {
  detector: string;
  households: number;
}

export const KNOWN_NOISE: readonly KnownNoise[] = [
  // the change sentences pass their gate on most steady months: the gate is under a month's noise
  { detector: "change season", households: 180 },
  { detector: "change usual", households: 171 },
  { detector: "change year", households: 126 },
];
