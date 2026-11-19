/** Marks on subscriptions, alerts, proposed loans and the questions the first page asks of the signed-in user. Own rows only. */
import { type MarkKind, MORTGAGE_QUESTION, notLoanKey, parseBillDueSubject, parseLoanKindSubject, parseLoanTermsSubject, parsePlanSubject, parseUnresolvedSubject, QUESTION_PAYEE, seriesOfMarkSubject } from "@banking/core";
import { Hono } from "hono";
import { isoIn } from "../platform/config.ts";
import { UserError } from "../platform/errors.ts";
import { strictObject } from "../platform/validate.ts";
import type { AppEnv, Services } from "../services/context.ts";
import { NOT_RECURRING, wrongBillKey } from "../services/wrong-bills.ts";
import { body } from "./shared.ts";

const MARK_KINDS: readonly MarkKind[] = ["in_use", "cancelled", "dismissed"];

/**
 * `series:<key>` (one subscription), `alert:<id>`, `not-recurring:<series key>` (a found bill that is no recurring bill,
 * services/wrong-bills.ts), `loan-proposal:<key>` ("Ei ole velan maksu" on a proposed loan, a subject of
 * its own so that a mark Laskut puts on the same series never replaces it), or `merchant:<name>` (every subscription of
 * a merchant: what a mark was before it named a series, kept so that those are still stored and taken away), or
 * `question:<name>` (the answer to a question the first page asks: `question:mortgage`, and `question:payee:<merchant>`
 * for a payee set aside from the list of what has no category, and `question:loan-kind:<kind>:<series key>` for what a
 * proposed loan is, `question:plan-end:<month>:<key>` or `question:plan-unknown:<key>` for where an instalment plan ends, and
 * `question:bill-due:<day>:<key>` for a bill that did not come and will still come, core bill-answer.ts, and
 * `question:unresolved:<reason>:<card id>` for a card of a notice about cards whose payer the rows do not show that was set aside, core unresolved-answer.ts, and `question:loan-terms:<loan id>` for a saved loan whose missing term was set aside, core loan-terms-answer.ts): 1 to 200 characters after the prefix and no control
 * characters. A series key of the longest stored name is under 100: a direction, an account id of
 * at most 28 characters, a name of at most 40 (core `normalizeMerchant`) and a price.
 */
const SUBJECT = /^(series|merchant|alert|loan-proposal|not-recurring|question):[^\p{Cc}]{1,200}$/u;

/** A user marks a handful of subscriptions and dismisses a few alerts; the cap only stops a script from filling the table. */
const MAX_MARKS = 2000;

/** The subjects one request may name: a notice sets one aside per card, and a household has few cards. */
const MAX_SUBJECTS = 200;

/** A payee set aside on the first page: the merchant is 1 to 200 characters, as the other names are. */
const PAYEE_NAME = /^[^\p{Cc}]{1,200}$/u;

function parseSubject(value: unknown): string {
  if (typeof value === "string" && value.startsWith(QUESTION_PAYEE) && PAYEE_NAME.test(value.slice(QUESTION_PAYEE.length))) return value;
  const form = typeof value === "string" ? SUBJECT.exec(value)?.[1] : undefined;
  if (typeof value !== "string" || form === undefined) throw new UserError("Virheellinen kohde.");
  // a series is named the way core reads it back: a direction, an account and a merchant. Whether the user has such a
  // series is not asked: a mark on one that is gone covers nothing and can still be taken away.
  if (form === "series" && !seriesOfMarkSubject(value)?.accountId) throw new UserError("Virheellinen kohde.");
  // a proposed loan is named by the key of its series, read the same way
  if (form === "loan-proposal" && notLoanKey(value) === null) throw new UserError("Virheellinen kohde.");
  // a bill that is no recurring bill is named by the key of its series too
  if (form === "not-recurring" && wrongBillKey(value) === null) throw new UserError("Virheellinen kohde.");
  // the other question the first page asks (a payee is taken above)
  if (form === "question" && value !== MORTGAGE_QUESTION && parseLoanKindSubject(value) === null && parsePlanSubject(value) === null && parseBillDueSubject(value) === null && parseUnresolvedSubject(value) === null && parseLoanTermsSubject(value) === null) throw new UserError("Virheellinen kohde.");
  return value;
}

/** The subjects of a request: `subject`, or `subjects` for the same mark on several at once. Every one is checked as a single subject is. */
function parseSubjects(input: Partial<Record<"subject" | "subjects", unknown>>): string[] {
  if ((input.subject === undefined) === (input.subjects === undefined)) throw new UserError("Virheellinen kohde.");
  if (input.subject !== undefined) return [parseSubject(input.subject)];
  if (!Array.isArray(input.subjects) || input.subjects.length < 1 || input.subjects.length > MAX_SUBJECTS) throw new UserError("Virheellinen kohde.");
  return [...new Set(input.subjects.map(parseSubject))];
}

/** A mark from the allowlist, or null to take the mark away. */
function parseMark(value: unknown): MarkKind | null {
  if (value === null) return null;
  if (typeof value !== "string" || !(MARK_KINDS as readonly string[]).includes(value)) throw new UserError("Virheellinen merkintä.");
  return value as MarkKind;
}

export function marksRoutes(s: Services) {
  const app = new Hono<AppEnv>();

  // one mark per subject; null takes it away. Marks are read for each request, so no data version is bumped.
  app.put("/marks", async (c) => {
    const repo = s.finance(c.get("user").id);
    const input = strictObject(await body(c), ["subject", "subjects", "mark"] as const);
    const subjects = parseSubjects(input);
    const mark = parseMark(input.mark);
    for (const subject of subjects) {
      // a payee is set aside or taken back, nothing else
      if (mark !== null && mark !== "dismissed" && subject.startsWith(QUESTION_PAYEE)) throw new UserError("Virheellinen merkintä.");
      // a bill is marked away or taken back, nothing else
      if (mark !== null && mark !== "dismissed" && subject.startsWith(NOT_RECURRING)) throw new UserError("Virheellinen merkintä.");
      // a notice is set aside or taken back, nothing else, and the mark is written for one card: a subject of several cards is what earlier versions stored, still read and taken away but never written
      const unresolved = parseUnresolvedSubject(subject);
      if (mark !== null && unresolved !== null && (mark !== "dismissed" || unresolved.cardIds.length !== 1)) throw new UserError("Virheellinen merkintä.");
      // a saved loan's missing term is set aside or taken back, nothing else
      if (mark !== null && mark !== "dismissed" && parseLoanTermsSubject(subject) !== null) throw new UserError("Virheellinen merkintä.");
      // what a loan is, is told or taken back, nothing else
      if (mark !== null && mark !== "in_use" && (parseLoanKindSubject(subject) !== null || parsePlanSubject(subject) !== null || parseBillDueSubject(subject) !== null)) throw new UserError("Virheellinen merkintä.");
    }
    if (mark === null) {
      // taking a mark away is one subject at a time
      if (subjects.length !== 1) throw new UserError("Virheellinen kohde.");
      await repo.clearMark(subjects[0]!);
    } else {
      const current = await repo.listMarks();
      const stored = new Set(current.map((m) => m.subject));
      if (current.length + subjects.filter((subject) => !stored.has(subject)).length > MAX_MARKS) throw new UserError("Merkintöjä on liikaa.");
      // local to the instance: the alerts compare the day of a mark with booking dates. One transaction: a notice is dismissed for every card or for none
      await repo.setMarks(subjects, mark, isoIn(s.instance.current.timezone, s.now()));
    }
    return c.json({ marks: await repo.listMarks() });
  });

  return app;
}
