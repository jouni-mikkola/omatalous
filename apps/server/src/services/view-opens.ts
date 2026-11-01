/**
 * Which views the household opens (docs/ROADMAP.md, Later 11). A page tells the server the views it showed; only the day
 * of the opening is kept per view and member, and the admin reads the views nobody opened for a quarter. Nothing is sent
 * out. It is a display record like the language: no data version moves and nothing is reprocessed.
 */
import { addDays } from "@banking/core";
import { isoIn } from "../platform/config.ts";
import { UserError } from "../platform/errors.ts";
import type { Services } from "./context.ts";

/** `report:<section id>`, `insight:<source>`, `finding:<area>:<kind>`: lower case, digits, dash and underscore. */
const VIEW = /^(report:[a-z0-9_-]{1,60}|insight:[a-z0-9_-]{1,60}|finding:[a-z0-9_-]{1,40}:[a-z0-9_-]{1,60})$/;
/** One page shows a few dozen at most. */
const MAX_PER_REQUEST = 60;
/** A script cannot fill the table: far more than the views there are. */
const MAX_PER_USER = 600;
/** A view nobody opened for this long is listed. */
const UNOPENED_DAYS = 90;

export async function recordViewOpens(s: Services, userId: string, input: { views?: unknown }): Promise<void> {
  const { views } = input;
  if (!Array.isArray(views) || views.length > MAX_PER_REQUEST || !views.every((v) => typeof v === "string" && VIEW.test(v))) throw new UserError("Virheellinen kohde.");
  const unique = [...new Set(views as string[])];
  if (unique.length === 0) return;
  if ((await s.viewOpens.count(userId)) >= MAX_PER_USER) return;
  // the instance's own day, as marks have
  await s.viewOpens.record(userId, unique, isoIn(s.instance.current.timezone, s.now()).slice(0, 10));
}

export interface UnopenedViews {
  /** The day the install first recorded an opening: before it nothing is known. */
  since: string | null;
  today: string;
  days: number;
  /** Views opened before, and not by anyone in `days` days, with their last day. Oldest first. */
  views: { view: string; lastDay: string }[];
  /** Every view anyone opened, so the page can tell a view opened lately from one never opened. */
  opened: string[];
}

export async function unopenedViews(s: Services): Promise<UnopenedViews> {
  const today = isoIn(s.instance.current.timezone, s.now()).slice(0, 10);
  const edge = addDays(today, -UNOPENED_DAYS);
  const { since, views } = await s.viewOpens.lastOpened();
  return { since, today, days: UNOPENED_DAYS, views: views.filter((v) => v.lastDay < edge), opened: views.map((v) => v.view) };
}
