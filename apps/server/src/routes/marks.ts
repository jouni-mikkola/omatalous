/** Marks on subscriptions and alerts of the signed-in user. Own rows only. */
import type { MarkKind } from "@banking/core";
import { Hono } from "hono";
import { isoIn } from "../platform/config.ts";
import { UserError } from "../platform/errors.ts";
import { strictObject } from "../platform/validate.ts";
import type { AppEnv, Services } from "../services/context.ts";
import { body } from "./shared.ts";

const MARK_KINDS: readonly MarkKind[] = ["in_use", "cancelled", "dismissed"];

/** `merchant:<name>` or `alert:<id>`, 1 to 200 characters after the prefix and no control characters. */
const SUBJECT = /^(?:merchant|alert):[^\p{Cc}]{1,200}$/u;

/** A user marks a handful of subscriptions and dismisses a few alerts; the cap only stops a script from filling the table. */
const MAX_MARKS = 2000;

function parseSubject(value: unknown): string {
  if (typeof value !== "string" || !SUBJECT.test(value)) throw new UserError("Virheellinen kohde.");
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
