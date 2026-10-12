/** Marks on subscriptions, alerts, proposed loans and the question about a home loan of the signed-in user. Own rows only. */
import { type MarkKind, MORTGAGE_QUESTION, notLoanKey, seriesOfMarkSubject } from "@banking/core";
import { Hono } from "hono";
import { isoIn } from "../platform/config.ts";
import { UserError } from "../platform/errors.ts";
import { strictObject } from "../platform/validate.ts";
import type { AppEnv, Services } from "../services/context.ts";
import { body } from "./shared.ts";

const MARK_KINDS: readonly MarkKind[] = ["in_use", "cancelled", "dismissed"];

/**
 * `series:<key>` (one subscription), `alert:<id>`, `loan-proposal:<key>` ("Ei laina" on a proposed loan, a subject of
 * its own so that a mark Laskut puts on the same series never replaces it), or `merchant:<name>` (every subscription of
 * a merchant: what a mark was before it named a series, kept so that those are still stored and taken away), or
 * `question:<name>` (the answer to a question the first page asks, of which there is one): 1 to 200 characters after the
 * prefix and no control characters. A series key of the longest stored name is under 100: a direction, an account id of
 * at most 28 characters, a name of at most 40 (core `normalizeMerchant`) and a price.
 */
const SUBJECT = /^(series|merchant|alert|loan-proposal|question):[^\p{Cc}]{1,200}$/u;

/** A user marks a handful of subscriptions and dismisses a few alerts; the cap only stops a script from filling the table. */
const MAX_MARKS = 2000;

function parseSubject(value: unknown): string {
  const form = typeof value === "string" ? SUBJECT.exec(value)?.[1] : undefined;
  if (typeof value !== "string" || form === undefined) throw new UserError("Virheellinen kohde.");
  // a series is named the way core reads it back: a direction, an account and a merchant. Whether the user has such a
  // series is not asked: a mark on one that is gone covers nothing and can still be taken away.
  if (form === "series" && !seriesOfMarkSubject(value)?.accountId) throw new UserError("Virheellinen kohde.");
  // a proposed loan is named by the key of its series, read the same way
  if (form === "loan-proposal" && notLoanKey(value) === null) throw new UserError("Virheellinen kohde.");
  // the one question the first page asks
  if (form === "question" && value !== MORTGAGE_QUESTION) throw new UserError("Virheellinen kohde.");
  return value;
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
    const input = strictObject(await body(c), ["subject", "mark"] as const);
    const subject = parseSubject(input.subject);
    const mark = parseMark(input.mark);
    if (mark === null) {
      await repo.clearMark(subject);
    } else {
      const current = await repo.listMarks();
      if (current.length >= MAX_MARKS && !current.some((m) => m.subject === subject)) throw new UserError("Merkintöjä on liikaa.");
      // local to the instance: the alerts compare the day of a mark with booking dates
      await repo.setMark(subject, mark, isoIn(s.instance.current.timezone, s.now()));
    }
    return c.json({ marks: await repo.listMarks() });
  });

  return app;
}
