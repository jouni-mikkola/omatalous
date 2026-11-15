/**
 * "Älä muistuta tästä enää" on a notice of Tarkistettavat about a card whose payer the rows do not show. The household
 * cannot mend it from the page, so the answer is one mark `dismissed` per card the notice names, on
 * `question:unresolved:<reason>:<card id>`. One card per subject keeps every subject short however many cards the
 * notice names.
 * The notice stays away while every card it names now has a dismissal of the same reason. A card that is paid off
 * leaves the notice and the rest stay away; a card that joins, with no dismissal of its own, brings it back. The amount
 * does not matter: a card's debt swings with every billing cycle, and a notice that returned with it would return nearly
 * every month.
 * Earlier versions stored one mark for the whole set, `question:unresolved:<reason>:<id>,<id>`. Those still parse and
 * each counts for all of its ids, and nothing writes them any more.
 */
import type { UserMark } from "./types.ts";

/** The reasons a notice is made for: the engine's `unresolved` reasons that the household can end by connecting an account. */
export const UNRESOLVED_REASONS = ["card_payer_unseen"] as const;

export type UnresolvedReason = (typeof UNRESOLVED_REASONS)[number];

const UNRESOLVED = "question:unresolved:";
const ID = "[^:,\\p{Cc}]{1,64}";
const SUBJECT = new RegExp(`^question:unresolved:([a-z_]{1,32}):(${ID}(?:,${ID})*)$`, "u");

/** The subjects of the dismissal of a notice about `reason` for these cards: one per card, sorted and without repeats. */
export const unresolvedSubjects = (reason: UnresolvedReason, cardIds: readonly string[]): string[] => [...new Set(cardIds)].sort().map((id) => `${UNRESOLVED}${reason}:${id}`);

/** The reason and card ids a dismissal subject names (one id, or the several of a subject an earlier version stored), or null for any other subject and a reason no notice has. */
export function parseUnresolvedSubject(subject: string): { reason: UnresolvedReason; cardIds: string[] } | null {
  const found = SUBJECT.exec(subject);
  const reason = UNRESOLVED_REASONS.find((r) => r === found?.[1]);
  return found && reason ? { reason, cardIds: found[2]!.split(",") } : null;
}

/** Whether dismissals of the same reason stand: every card the notice names now is named by one of them. */
export function unresolvedDismissed(marks: readonly Pick<UserMark, "subject" | "mark">[], reason: UnresolvedReason, cardIds: readonly string[]): boolean {
  const named = new Set<string>();
  for (const m of marks) {
    const then = m.mark === "dismissed" ? parseUnresolvedSubject(m.subject) : null;
    if (then?.reason === reason) for (const id of then.cardIds) named.add(id);
  }
  return cardIds.every((id) => named.has(id));
}
