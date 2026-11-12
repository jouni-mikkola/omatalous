/**
 * "Tulee vielä", the household's word that a bill that did not come (`missedOn`) will still come. It is a mark `in_use`
 * on `question:bill-due:<YYYY-MM-DD>:<series key>`, named by the due day it was given for. The subject is its own
 * because the same mark on `series:<key>` reads as "in use" for a year: the renewal tips, the forgotten-service question
 * and the price rises would go quiet. This answer covers one missed charge and says nothing else of the series.
 * Old answers stay stored, one per answered due day, which is little beside the route's cap on marks. A merchant rename
 * does not move them (`renamedMarkSubject` reads `series:` subjects), as with the plan answers: the question can come
 * once more after one.
 */

const BILL_DUE = "question:bill-due:";
const SERIES_SUBJECT = "series:";
/** A series key (`seriesId`, ADR 0009) of money out by its shape, as plan-answer.ts reads it. */
const SERIES_KEY = /^out:[^:\p{Cc}]{1,28}:[^\p{Cc}]{1,160}$/u;
const DAY = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/** The subject of "Tulee vielä" for the series a mark subject names (`series:<key>`, `seriesMarkSubject`) and the day its charge was due. */
export const billDueSubject = (seriesSubject: string, dueDate: string): string => `${BILL_DUE}${dueDate}:${seriesSubject.startsWith(SERIES_SUBJECT) ? seriesSubject.slice(SERIES_SUBJECT.length) : seriesSubject}`;

/** The due day and series key a "Tulee vielä" subject names, or null for any other subject, a day that is none and a key no series has. */
export function parseBillDueSubject(subject: string): { dueDate: string; key: string } | null {
  if (!subject.startsWith(BILL_DUE)) return null;
  const rest = subject.slice(BILL_DUE.length);
  const dueDate = rest.slice(0, 10);
  const key = rest.slice(11);
  return DAY.test(dueDate) && rest[10] === ":" && SERIES_KEY.test(key) ? { dueDate, key } : null;
}
