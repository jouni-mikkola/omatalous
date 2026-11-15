/**
 * "Älä muistuta tästä enää" on a notice of Tarkistettavat about a card whose payer the rows do not show. The household
 * cannot mend it from the page, so the answer is a mark `dismissed` on `question:unresolved:<reason>:<set>`, named
 * by the reason and a hash of the cards the notice named when it was dismissed (their ids sorted and joined with
 * commas). The hash keeps the subject short however many cards the notice names; the ids alone would pass the 200
 * characters a subject may have at about 7 cards.
 * The notice stays away while the cards it names are the set a dismissal of the same reason named. It comes back when
 * the set changes. The amount does not matter: a card's debt swings with every billing cycle, and a notice that
 * returned with it would return nearly every month.
 */
import type { UserMark } from "./types.ts";

/** The reasons a notice is made for: the engine's `unresolved` reasons that the household can end by connecting an account. */
export const UNRESOLVED_REASONS = ["card_payer_unseen"] as const;

export type UnresolvedReason = (typeof UNRESOLVED_REASONS)[number];

const UNRESOLVED = "question:unresolved:";
const SUBJECT = /^question:unresolved:([a-z_]{1,32}):([0-9a-f]{14})$/u;

/** A 53-bit hash (cyrb53) as 14 hex digits: stable across runs and the same on Node and in the browser, which core must be. */
function hashOf(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 & 0x1fffff).toString(16).padStart(6, "0") + (h1 >>> 0).toString(16).padStart(8, "0");
}

/** The subject of the dismissal of a notice about `reason` for these cards: the hash of their ids, sorted and without repeats. */
export const unresolvedSubject = (reason: UnresolvedReason, cardIds: readonly string[]): string => `${UNRESOLVED}${reason}:${hashOf([...new Set(cardIds)].sort().join(","))}`;

/** The reason a dismissal subject names, or null for any other subject and a reason no notice has. */
export function parseUnresolvedSubject(subject: string): { reason: UnresolvedReason } | null {
  const found = SUBJECT.exec(subject);
  const reason = UNRESOLVED_REASONS.find((r) => r === found?.[1]);
  return found && reason ? { reason } : null;
}

/** Whether a dismissal of the same reason stands: one set aside named exactly the cards the notice names now. */
export function unresolvedDismissed(marks: readonly Pick<UserMark, "subject" | "mark">[], reason: UnresolvedReason, cardIds: readonly string[]): boolean {
  const now = unresolvedSubject(reason, cardIds);
  return marks.some((m) => m.mark === "dismissed" && m.subject === now);
}
