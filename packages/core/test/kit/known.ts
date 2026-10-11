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

export const KNOWN_EVENT_STATEMENTS: readonly KnownEventStatement[] = [
  { event: "card-connected-late", statement: "insights spending-growth", why: "the card's purchases since it was connected in May called growth in purchases (Ostokset +N % vuodessa)" },
  { event: "card-connected-late", statement: "insights subscriptions-added", why: "subscriptions paid by a card connected in May called subscriptions added (Tilauksia 3, vuosi sitten 1)" },
];

/** A detector that fires on more steady households than the noise budget allows, with how many of the 200 it fires on. */
export interface KnownNoise {
  detector: string;
  households: number;
}

export const KNOWN_NOISE: readonly KnownNoise[] = [];
