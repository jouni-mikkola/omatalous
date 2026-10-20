/**
 * Optimoi, mounted at its own prefix behind the `optimise` flag. The route parses the request and calls
 * services/optimise.ts, which builds the page and owns the writes (inputs, decisions, the monthly snapshot).
 */
import { addDays, DISMISS_REASONS, type DismissReason, type IsoDate, parseFindingId } from "@banking/core";
import { Hono } from "hono";
import { UserError } from "../platform/errors.ts";
import { isIsoDate, strictObject } from "../platform/validate.ts";
import { parseScope } from "../services/analysis.ts";
import type { AppEnv, Services } from "../services/context.ts";
import { decide, deleteInput, optimiseEvidence, optimisePage, setInput, type StateRequest } from "../services/optimise.ts";
import { body } from "./shared.ts";

/** How far a done decision may date back or ahead, and how far a snooze may reach, in days. */
const DONE_DAYS = 365;
const SNOOZE_DAYS = 365;

const STATUSES = ["done", "dismissed", "snoozed"] as const;

const absent = (v: unknown) => v === undefined || v === null;

function parseId(value: unknown): string {
  if (typeof value !== "string" || !parseFindingId(value)) throw new UserError("Virheellinen vinkin tunniste.");
  return value;
}

/** The state to store from the request: only the fields that belong to its status, checked against allowlists. */
function parseState(raw: unknown, today: IsoDate): StateRequest {
  const input = strictObject(raw, ["status", "reason", "until", "effectiveDate"] as const);
  const status = input.status;
  if (status === undefined || (status !== null && !(STATUSES as readonly unknown[]).includes(status))) throw new UserError("Valitse tila: tehty, ei koske meitä tai lykätty.");
  const stray = () => new UserError("Kenttä ei kuulu tähän valintaan.");
  if (status !== "dismissed" && !absent(input.reason)) throw stray();
  if (status !== "snoozed" && !absent(input.until)) throw stray();
  if (status !== "done" && !absent(input.effectiveDate)) throw stray();

  let reason: DismissReason | null = null;
  if (!absent(input.reason)) {
    if (typeof input.reason !== "string" || !(DISMISS_REASONS as readonly string[]).includes(input.reason)) throw new UserError("Valitse syy listasta.");
    reason = input.reason as DismissReason;
  }
  let until: IsoDate | null = null;
  if (status === "snoozed") {
    // the finding is hidden before this day, so tomorrow is the first that hides anything
    if (!isIsoDate(input.until) || input.until <= today || input.until > addDays(today, SNOOZE_DAYS)) throw new UserError("Anna päivä, joka on aikaisintaan huomenna ja enintään vuoden päässä.");
    until = input.until;
  }
  let effectiveDate: IsoDate | null = null;
  if (!absent(input.effectiveDate)) {
    const day = input.effectiveDate;
    if (!isIsoDate(day) || day < addDays(today, -DONE_DAYS) || day > addDays(today, DONE_DAYS)) throw new UserError("Anna päivä, joka on enintään vuoden päässä.");
    effectiveDate = day;
  }
  return { status: status as StateRequest["status"], reason, until, effectiveDate };
}

export function optimiseRoutes(s: Services) {
  const app = new Hono<AppEnv>();

  app.get("/", async (c) => c.json(await optimisePage(s, c.get("user").id, parseScope(c.req.query("scope")))));

  app.get("/evidence", async (c) => {
    const id = parseId(c.req.query("id"));
    return c.json(await optimiseEvidence(s, c.get("user").id, parseScope(c.req.query("scope")), id));
  });

  app.put("/inputs/:key", async (c) => {
    const { value } = strictObject(await body(c), ["value"] as const);
    return c.json(await setInput(s, c.get("user").id, parseScope(c.req.query("scope")), c.req.param("key"), value));
  });

  app.delete("/inputs/:key", async (c) => c.json(await deleteInput(s, c.get("user").id, c.req.param("key"))));

  app.put("/findings/:id", async (c) => {
    const id = parseId(c.req.param("id"));
    const request = parseState(await body(c), s.today());
    return c.json(await decide(s, c.get("user").id, parseScope(c.req.query("scope")), id, request));
  });

  return app;
}
