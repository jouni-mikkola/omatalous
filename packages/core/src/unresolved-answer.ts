/**
 * "Älä muistuta tästä enää" on a notice of Tarkistettavat about a card whose payer the rows do not show. The household
 * cannot mend it from the page, so the answer is a mark `dismissed` on `question:unresolved:<reason>:<card ids>`, named
 * by the reason and the cards the notice named when it was dismissed (their ids sorted, joined with commas).
 * The notice stays away while every card it names is in a dismissed set of the same reason. It comes back only when a
 * card joins that was in none of them. The amount does not matter: a card's debt swings with every billing cycle, and a
 * notice that returned with it would return nearly every month.
 */
import type { UserMark } from "./types.ts";

/** The reasons a notice is made for: the engine's `unresolved` reasons that the household can end by connecting an account. */
export const UNRESOLVED_REASONS = ["card_payer_unseen"] as const;

export type UnresolvedReason = (typeof UNRESOLVED_REASONS)[number];

const UNRESOLVED = "question:unresolved:";
const ID = "[^:,\\p{Cc}]{1,64}";
const SUBJECT = new RegExp(`^question:unresolved:([a-z_]{1,32}):(${ID}(?:,${ID})*)$`, "u");

/** The subject of the dismissal of a notice about `reason` for these cards. */
export const unresolvedSubject = (reason: UnresolvedReason, cardIds: readonly string[]): string => `${UNRESOLVED}${reason}:${[...new Set(cardIds)].sort().join(",")}`;

/** The reason and card ids a dismissal subject names, or null for any other subject and a reason no notice has. */
export function parseUnresolvedSubject(subject: string): { reason: UnresolvedReason; cardIds: string[] } | null {
  const found = SUBJECT.exec(subject);
  const reason = UNRESOLVED_REASONS.find((r) => r === found?.[1]);
  return found && reason ? { reason, cardIds: found[2]!.split(",") } : null;
}

/** Whether a dismissal of the same reason stands: one set aside holds every card the notice names now. */
export function unresolvedDismissed(marks: readonly Pick<UserMark, "subject" | "mark">[], reason: UnresolvedReason, cardIds: readonly string[]): boolean {
  return marks.some((m) => {
    const then = m.mark === "dismissed" ? parseUnresolvedSubject(m.subject) : null;
    return then?.reason === reason && cardIds.every((id) => then.cardIds.includes(id));
  });
}
