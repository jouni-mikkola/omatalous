/**
 * The whole page on the joined household (household.ts): every area with a finding kind hits, every near miss stays
 * quiet in all thirteen areas, the headline is the overlap-free sum of rule 6, and every sentence the page prints
 * from the data, the follow-up included, passes the style of repo rule 12.
 */
import { describe, expect, it } from "vitest";
import { allFindings, AREA_IDS, type AreaId, baselineOf, buildOptimise, type Finding, type FindingState, followUpOf, type OptimiseData } from "../../src/index.ts";
import { FRAME, household, householdInput, joinHousehold, PARTS } from "./household.ts";

/** Lapset only states the day-care fee change in its check: the fee follows income, family size and hours. */
const CHECK_ONLY: readonly AreaId[] = ["kids"];

const INPUT = householdInput(household());
const DATA = buildOptimise(INPUT);
const shown = (data: OptimiseData) => data.areas.flatMap((a) => a.findings);
const mid = (f: Finding) => f.euros?.midCents ?? 0;

describe("Optimoi on the joined household", () => {
  it("every area with a finding kind hits, and Lapset gives only its check", () => {
    for (const id of AREA_IDS) {
      const view = DATA.areas.find((a) => a.id === id)!;
      if (CHECK_ONLY.includes(id)) {
        expect(view.findings, id).toEqual([]);
        expect(view.checks.length, id).toBeGreaterThan(0);
      } else expect(view.findings.length, id).toBeGreaterThan(0);
    }
  });

  it("each near miss stays quiet in every area", () => {
    const loud: string[] = [];
    for (const [id, part] of Object.entries(PARTS)) {
      part.nearMiss(FRAME).forEach((near, i) => {
        for (const f of allFindings(buildOptimise(householdInput(joinHousehold([near]))))) loud.push(`${id} near miss ${i}: ${f.id}`);
      });
    }
    expect(loud).toEqual([]);
  });

  it("sums the headline without overlaps: largest first, a finding sharing over half its claims with one counted is left out", () => {
    // left out of the sum, each for its reason
    const deadlines = ["subscriptions:renewal:out:h-chk:Storytel", "electricity:contract_end"];
    const apart = ["housing:rise:out:h-chk:As Oy Kotikallio"];
    const overlapped: Record<string, string> = {
      "food:delivery:Wolt": "food:eating_out",
      "loans:margin:out:h-chk:Nordea": "loans:prepay",
      "insurance:rise:out:h-chk:LähiTapiola": "insurance:renewal:out:h-chk:LähiTapiola",
      "seasons:month:07": "loans:card_interest",
    };
    const findings = shown(DATA);
    const byId = new Map(findings.map((f) => [f.id, f]));
    for (const id of [...deadlines, ...apart, ...Object.entries(overlapped).flat()]) expect(byId.has(id), id).toBe(true);
    for (const id of deadlines) expect(byId.get(id)!.euros).toBeNull();
    for (const id of apart) expect(byId.get(id)!.shared || byId.get(id)!.certainty.level === "matala").toBe(true);
    for (const [id, by] of Object.entries(overlapped)) {
      const [f, g] = [byId.get(id)!, byId.get(by)!];
      expect(mid(g), `${by} is counted before ${id}`).toBeGreaterThanOrEqual(mid(f));
      expect(f.claims.filter((k) => g.claims.includes(k)).length * 2, id).toBeGreaterThan(f.claims.length);
    }
    const left = new Set([...deadlines, ...apart, ...Object.keys(overlapped)]);
    const counted = findings.filter((f) => !left.has(f.id));
    expect(DATA.headline).toEqual({
      lowCents: counted.reduce((s, f) => s + f.euros!.lowCents, 0),
      midCents: counted.reduce((s, f) => s + f.euros!.midCents, 0),
      highCents: counted.reduce((s, f) => s + f.euros!.highCents, 0),
      count: counted.length,
    });
    expect(DATA.headline.count).toBe(13);

    // a done decision leaves the sum, and the finding it overlapped is counted in its place
    const eatingOut = byId.get("food:eating_out")!;
    const done: FindingState = { findingId: eatingOut.id, status: "done", reason: null, until: null, effectiveDate: INPUT.ctx.today, midCents: mid(eatingOut), baseline: null, decidedAt: `${INPUT.ctx.today}T12:00:00+03:00` };
    const after = buildOptimise({ ...INPUT, states: [done] }).headline;
    expect(after.midCents).toBe(DATA.headline.midCents - mid(eatingOut) + mid(byId.get("food:delivery:Wolt")!));
    expect(after.count).toBe(13);
  });

  it("every sentence the page prints from the data and the follow-up passes repo rule 12", () => {
    // the follow-up's reasons too: every shown finding marked done half a year back
    const states: FindingState[] = shown(DATA).map((f) => ({
      findingId: f.id,
      status: "done",
      reason: null,
      until: null,
      effectiveDate: "2026-04-01",
      midCents: f.euros?.midCents ?? null,
      baseline: [...baselineOf(INPUT.ctx, f, "2026-04-01")],
      decidedAt: "2026-04-01T12:00:00+03:00",
    }));
    const decided = buildOptimise({ ...INPUT, states });
    const followUp = followUpOf(INPUT.ctx, decided, []);
    expect(followUp.outcomes.length).toBe(states.length);
    const texts = [...textsIn(DATA), ...textsIn(decided), ...textsIn(followUp)];
    expect(texts.length).toBeGreaterThan(200);
    const broken = texts.flatMap((t) => RULE_12.filter(([re]) => re.test(t)).map(([, name]) => `${name}: ${t}`));
    expect(broken).toEqual([]);
  });
});

/** Keys whose strings are codes, ids or dates, never read as text. */
const CODES = new Set(["id", "findingId", "rows", "struck", "claims", "measure", "facts", "needs", "subject", "kind", "area", "areas", "key", "input", "status", "level", "effort", "unit", "verdict", "month", "today", "end", "dataTo", "decideBy", "effectiveDate", "until", "decidedAt", "asOf", "date", "baseline"]);

function textsIn(value: unknown, key = ""): string[] {
  if (CODES.has(key)) return [];
  if (typeof value === "string") return value ? [value] : [];
  if (Array.isArray(value)) return value.flatMap((v) => textsIn(v));
  if (value && typeof value === "object") return Object.entries(value).flatMap(([k, v]) => textsIn(v, k));
  return [];
}

/** The forms of repo rule 12 (tools/repo-rules/text-rules.ts) that a generated sentence can break. */
const RULE_12: [RegExp, string][] = [
  [/\p{L}+tte(ko|kö)(?!\p{L})/iu, "te-form verb"],
  [/!/, "exclamation mark"],
  [/\bKa\/kk\b|%-yks\./i, "banned abbreviation"],
  [/(?<!\p{L})(krt|kpl|esim\.|vs\.)(?!\p{L})|(?<![/\p{L}])kk(?!\p{L})|\d\s?€?\/v(?!\p{L})/iu, "banned abbreviation"],
  [/(?<!\p{L})demodat\p{L}*/iu, "rejected term"],
  [/(?<!\p{L})arjen (ostok|kulutu|men)\p{L}*/iu, "rejected term"],
  [/(?<!\p{L})vakiomaks\p{L}*/iu, "rejected term"],
  [/(?<!\p{L})(normaali\p{L}*|oma(n|an)? taso\p{L}*|oman tasonsa)/iu, "rejected term"],
  [/(?<!\p{L})(kulut|kuluja|kulujen|kuluihin|kuluista)(?!\p{L})/iu, "rejected term"],
  [/(?<!\p{L})(tilitapahtum|kaupparekister)\p{L}*/iu, "rejected term"],
  [/(?<!\p{L})(kannattaa|kannattaisi|riittävä|tarkoituksellis\p{L}*|kyseinen|kyseisen|kyseiseltä|on tärkeää)(?!\p{L})|(^|[.?]\s+)Voit\s/iu, "advice or verdict word"],
  [/(^|\s)-\d/, "ASCII hyphen before a digit"],
  [/(?<!\p{L})noin\s+[\d\s ]+,\d\d/iu, '"noin" beside cents'],
];
