/**
 * Metamorphic test of every statement source: an event may only add the statements its file allows. A statement is
 * added when its `<source> <id>` is not in the base household's list, or was there quiet (a change sentence under its
 * gate, a follow-up that waits) and is loud with the event. A statement the event makes that its file does not allow
 * is a false finding: fix it, or list it in known.ts until the brief that fixes it. The list may only shrink.
 */
import { describe, expect, it } from "vitest";
import { contextOf } from "../../../../tools/findings/households.ts";
import { monthToDate, type Statement, statements } from "../../../../tools/findings/statements.ts";
import { spendingChangeReport } from "../../src/reports/spending-change.ts";
import { EVENTS, kitHousehold, type LifeEvent } from "./index.ts";
import { KNOWN_EVENT_STATEMENTS } from "./known.ts";

const key = (s: Pick<Statement, "source" | "id">) => `${s.source} ${s.id}`;

/** The loud statements with the event that the base did not make loud. */
function added(base: readonly Statement[], after: readonly Statement[]): Statement[] {
  const loud = new Set(base.filter((s) => s.loud).map(key));
  return after.filter((s) => s.loud && !loud.has(key(s)));
}

describe("the life-event kit", () => {
  const base = statements(kitHousehold(null));
  const made = new Map<string, Statement[]>();
  const madeBy = (event: LifeEvent) => made.get(event.id) ?? (made.set(event.id, added(base, statements(kitHousehold(event)))), made.get(event.id)!);

  it("starts from a quiet base: only the question about Spotify, paid 27 months", () => {
    // a loud base hides what an event adds under the same id, so a change here makes the kit blind: pick another seed
    expect(base.filter((s) => s.loud).map(key)).toEqual(["alerts forgotten:out:card:Spotify"]);
    // and far under each gate: a sentence just under its gate would flip on any event that moves a figure a little
    const h = kitHousehold(null);
    for (const v of spendingChangeReport(contextOf(h), monthToDate(h.today)).views) expect(Math.abs(v.change.changeCents), v.view).toBeLessThan(v.change.gateCents / 2);
  });

  it.each(EVENTS.map((e) => [e.id, e] as const))("%s adds only what it allows", (id, event) => {
    const extra = madeBy(event).filter((s) => !event.allows.some((re) => re.test(key(s))));
    const known = KNOWN_EVENT_STATEMENTS.filter((k) => k.event === id).map((k) => k.statement);
    // a statement that is not known is a new false finding; a known one that is gone was fixed: remove it from known.ts
    expect(extra.map((s) => `${key(s)}: ${s.title}`).filter((line) => !known.some((k) => line.startsWith(`${k}:`)))).toEqual([]);
    expect(known.filter((k) => !extra.some((s) => key(s) === k))).toEqual([]);
  });

  it("every allow pattern and known entry names a statement the event makes", () => {
    const unused: string[] = [];
    for (const e of EVENTS) {
      const keys = madeBy(e).map(key);
      for (const re of e.allows) if (!keys.some((k) => re.test(k))) unused.push(`${e.id} ${re}`);
    }
    expect(unused).toEqual([]);
    const ids = new Set(EVENTS.map((e) => e.id));
    expect(KNOWN_EVENT_STATEMENTS.filter((k) => !ids.has(k.event))).toEqual([]);
  });
});
