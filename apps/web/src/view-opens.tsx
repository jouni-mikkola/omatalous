/**
 * Tells the server which views a page showed (Asetukset > Palvelin lists the ones nobody opened for a quarter). Fire and
 * forget: a failure is ignored and nothing waits for it. Each view is sent once per day of this page load.
 */
import { useEffect } from "react";
import { api } from "./api.ts";
import { figuresOwner } from "./offline.ts";

const sent = new Set<string>();

/** A finding's id is `<area>:<kind>[:<subject>]`: the area and the kind name the view, the subject (a merchant) never leaves the page. */
export const findingView = (id: string): string => `finding:${id.split(":").slice(0, 2).join(":")}`;

/** An insight's id is `<source>[:<subject>]`. */
export const insightView = (id: string): string => `insight:${id.split(":")[0]}`;

/** The form the server accepts; a view of another form is left out, since the server refuses the whole list for one. */
const VIEW = /^(report:[a-z0-9_-]{1,60}|insight:[a-z0-9_-]{1,60}|finding:[a-z0-9_-]{1,40}:[a-z0-9_-]{1,60})$/;

export function noteOpened(views: readonly string[]): void {
  // the member too: another member signing in on the same page load has opened nothing yet
  const day = `${figuresOwner() ?? ""}|${new Date().toDateString()}`;
  const fresh = [...new Set(views.filter((v) => VIEW.test(v)))].filter((v) => !sent.has(`${day}|${v}`));
  if (fresh.length === 0) return;
  for (const v of fresh) sent.add(`${day}|${v}`);
  void api("/api/views/open", { method: "POST", body: { views: fresh.slice(0, 60) }, quiet: true }).catch(() => {});
}

/** Draws nothing; records its views when they change. */
export function Opened({ views }: { views: readonly string[] }) {
  const key = [...views].sort().join(",");
  useEffect(() => {
    noteOpened(key ? key.split(",") : []);
  }, [key]);
  return null;
}
