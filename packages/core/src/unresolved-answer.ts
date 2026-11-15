/**
 * "Ohita" on a notice of Tarkistettavat about a figure the app cannot prove (an unproven balance, a card whose payer the
 * rows do not show). The household cannot mend most of them, so the answer is a mark `dismissed` on
 * `question:unresolved:<reason>@<cents>`, named by the reason and the amount the notice told when it was dismissed.
 * The notice stays away while the same reason holds at an amount within `INSIGHT_RETURN_SHARE` of that one (a quarter,
 * as a dismissed finding returns). It comes back when the reason is another one, which is another subject, or when the
 * amount has moved by that share of the dismissed amount or more: then the notice says something it did not say before.
 */
import { INSIGHT_RETURN_SHARE } from "./thresholds.ts";
import type { UserMark } from "./types.ts";

/** The reasons a figure goes unproven: the engine's `unresolved` reasons of a card's payer and of a balance. */
export const UNRESOLVED_REASONS = ["card_payer_unseen", "card_payer_mixed", "no_reference_day", "only_available", "type_changed", "too_few"] as const;

export type UnresolvedReason = (typeof UNRESOLVED_REASONS)[number];

const UNRESOLVED = "question:unresolved:";
const SUBJECT = /^question:unresolved:([a-z_]{1,32})@(\d{1,15})$/;

/** The subject of the dismissal of a notice about `reason` at `cents`, the amount the notice tells. */
export const unresolvedSubject = (reason: UnresolvedReason, cents: number): string => `${UNRESOLVED}${reason}@${Math.round(Math.abs(cents))}`;

/** The reason and amount a dismissal subject names, or null for any other subject and a reason no notice has. */
export function parseUnresolvedSubject(subject: string): { reason: UnresolvedReason; cents: number } | null {
  const found = SUBJECT.exec(subject);
  const reason = UNRESOLVED_REASONS.find((r) => r === found?.[1]);
  return found && reason ? { reason, cents: Number(found[2]) } : null;
}

/** Whether a dismissal of the same reason stands: its amount is within `INSIGHT_RETURN_SHARE` of today's, by the amount it was dismissed at. */
export function unresolvedDismissed(marks: readonly Pick<UserMark, "subject" | "mark">[], reason: UnresolvedReason, cents: number): boolean {
  const now = Math.abs(cents);
  return marks.some((m) => {
    const then = m.mark === "dismissed" ? parseUnresolvedSubject(m.subject) : null;
    return then?.reason === reason && Math.abs(now - then.cents) < INSIGHT_RETURN_SHARE * then.cents;
  });
}
