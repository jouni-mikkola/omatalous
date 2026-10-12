/**
 * Rules 3 to 6 on every area's output over the joined household (household.ts): what each finding must be, whatever
 * the area. A new area passes these before its own tests mean anything.
 */
import { describe, expect, it } from "vitest";
import type { AnalysisContext } from "../../src/analysis/context.ts";
import {
  ACTION_VERBS,
  AREA_IDS,
  AREAS,
  type Area,
  areaInputOf,
  type AreaResult,
  buildOptimise,
  factOn,
  findingId,
  GATE_YEARLY_CENTS,
  inputDefOf,
  MAX_ROWS,
} from "../../src/optimise/index.ts";
import { rng } from "../gen.ts";
import { household, householdInput } from "./household.ts";
import { numbersIn } from "./numbers.ts";

const STYLE: [RegExp, string][] = [
  [/\p{L}+tte(ko|kö)(?!\p{L})/iu, "te-form"],
  [/!/, "exclamation mark"],
  [/(?<!\p{L})(kannattaa|kannattaisi|riittävä\p{L}*|paljon|kyseinen|kyseisen|on tärkeää|muista)(?!\p{L})/iu, "verdict or advice word"],
  [/(?<!\p{L})noin\s+[\d\s\u00a0]+,\d\d/iu, '"noin" beside cents'],
  [/(?<!\p{L})(kk|krt|kpl|vs\.|esim\.)(?!\p{L})/iu, "banned abbreviation"],
  [/(?<!\p{L})(kulut|kuluja|kulujen|kuluihin|kuluista)(?!\p{L})/iu, "rejected term"],
];


/** Everything wrong with one area's result, as "<id>: <what>". */
function problemsOf(area: Area, result: AreaResult, ctx: AnalysisContext): string[] {
  const out: string[] = [];
  const byId = new Map(ctx.txs.map((t) => [t.id, t]));
  const style = (where: string, text: string) => {
    for (const [re, name] of STYLE) if (re.test(text)) out.push(`${where}: ${name} in "${text}"`);
  };
  const ids = new Set<string>();
  const checkIds = new Set(result.checks.map((c) => c.id));
  for (const f of result.findings) {
    const at = f.id;
    if (f.area !== area.id) out.push(`${at}: area ${f.area} in ${area.id}`);
    if (f.id !== findingId(area.id, f.kind, f.subject)) out.push(`${at}: id is not findingId(area, kind, subject)`);
    if (ids.has(f.id)) out.push(`${at}: id twice`);
    ids.add(f.id);
    if (!checkIds.has(`${area.id}:${f.kind}`)) out.push(`${at}: no check ${area.id}:${f.kind}`);
    // rule 5: title, action, wording
    if (f.title.split(/(?<=[.?!])\s+(?=\p{Lu})/u).length > 2) out.push(`${at}: title over two sentences`);
    const calcText = f.calc.map((c) => `${c.label} ${c.value}`).join(" | ");
    const calcNumbers = new Set(numbersIn(calcText));
    for (const n of numbersIn(f.title)) if (!calcNumbers.has(n)) out.push(`${at}: ${n} in the title is in no calc line`);
    const verb = f.action.split(/[\s,.:]/)[0]!.toLowerCase();
    if (!(ACTION_VERBS as readonly string[]).includes(verb)) out.push(`${at}: action starts with "${verb}"`);
    for (const [where, text] of [["title", f.title], ["action", f.action], ...f.calc.map((c) => ["calc", c.label] as const), ...f.weaknesses.map((w) => ["weakness", w.reason] as const)] as const) style(`${at} ${where}`, text);
    // rule 6: euros
    if (f.euros) {
      const { lowCents: low, midCents: mid, highCents: high } = f.euros;
      if (![low, mid, high].every((x) => Number.isSafeInteger(x) && x > 0) || !(low <= mid && mid <= high)) out.push(`${at}: euros ${low} ${mid} ${high} are not 0 < low <= mid <= high cents`);
      if (!f.claims.length) out.push(`${at}: a euro finding without claims cannot be checked for overlap`);
    } else if (!f.decideBy) out.push(`${at}: neither euros nor a deadline`);
    // rule 4: rows
    if (f.rows.length > MAX_ROWS) out.push(`${at}: ${f.rows.length} rows`);
    if (new Set(f.rows).size !== f.rows.length) out.push(`${at}: a row twice`);
    for (const id of f.rows) {
      const t = byId.get(id);
      if (!t) out.push(`${at}: row ${id} is not in the context`);
      else if (t.isTransfer || t.category === "transfer") out.push(`${at}: row ${id} is a transfer`);
    }
    for (const id of f.struck) if (!f.rows.includes(id)) out.push(`${at}: struck ${id} is not among the rows`);
    if (f.measure.kind !== "none" && !f.measure.keys.length) out.push(`${at}: measure ${f.measure.kind} without keys`);
    for (const key of f.needs ?? []) if (!inputDefOf(key)) out.push(`${at}: needs ${key}, which is no input`);
    for (const id of f.facts) if (!factOn(id, ctx.today)) out.push(`${at}: fact ${id} is not valid on ${ctx.today}`);
  }
  for (const c of result.checks) {
    if (!c.id.startsWith(`${area.id}:`) || !c.label) out.push(`check ${c.id}: id must start with ${area.id}: and have a label`);
    if (c.status === "needs_input" && !(c.input && inputDefOf(c.input))) out.push(`check ${c.id}: needs_input without a valid input key`);
    for (const text of [c.label, c.hint ?? ""]) style(`check ${c.id}`, text);
  }
  if (checkIds.size !== result.checks.length) out.push(`${area.id}: a check id twice`);
  return out;
}

const H = household();
const INPUT = householdInput(H);
const A = areaInputOf(INPUT);

describe("optimise invariants over every area", () => {
  it("has the thirteen areas once each, with a Finnish label", () => {
    expect(AREAS.map((a) => a.id).sort()).toEqual([...AREA_IDS].sort());
    for (const a of AREAS) expect(a.label).toMatch(/^\p{Lu}[\p{L} -]{2,30}$/u);
  });

  it("every finding and check follows rules 3 to 6 on the joined household", () => {
    expect(AREAS.flatMap((area) => problemsOf(area, area.assess(A), A.ctx))).toEqual([]);
  });

  it("every finding shown passes the gate and has a certainty", () => {
    const data = buildOptimise(INPUT);
    for (const f of data.areas.flatMap((a) => a.findings)) {
      expect(f.euros === null || f.euros.midCents >= GATE_YEARLY_CENTS).toBe(true);
      expect(["korkea", "keskitaso", "matala"]).toContain(f.certainty.level);
    }
    expect(data.headline.midCents).toBeGreaterThanOrEqual(0);
  });

  it("keeps finding ids when the rows come in another order", () => {
    const r = rng(7);
    const shuffled = { ...H, txs: [...H.txs].sort(() => r() - 0.5) };
    const B = areaInputOf(householdInput(shuffled));
    for (const area of AREAS) expect(area.assess(B).findings.map((f) => f.id).sort(), area.id).toEqual(area.assess(A).findings.map((f) => f.id).sort());
  });

  it("the checker finds what it is for", () => {
    const area: Area = { id: "bank", label: "Pankkikulut", assess: () => ({ findings: [], checks: [] }) };
    const transfer = A.ctx.txs.find((t) => t.isTransfer)!;
    const bad: AreaResult = {
      findings: [
        {
          id: "bank:fees",
          area: "bank",
          kind: "fees",
          subject: "Nordea",
          title: "Kulut nousivat 240 € vuodessa! Kannattaa vaihtaa. Kolmas lause.",
          action: "Harkitse vaihtoa.",
          euros: { lowCents: 30000, midCents: 24000, highCents: 36000 },
          decideBy: null,
          weaknesses: [],
          shared: false,
          calc: [{ label: "Kulut", value: "120 €" }],
          rows: [transfer.id, "nope"],
          struck: ["other"],
          claims: [],
          measure: { kind: "series", keys: [] },
          needs: ["nope"],
          facts: ["no_such_fact"],
        },
      ],
      checks: [{ id: "loans:x", label: "", status: "needs_input" }],
    };
    const found = problemsOf(area, bad, A.ctx).join("\n");
    for (const part of [
      "id is not findingId",
      "no check bank:fees",
      "title over two sentences",
      "240 in the title is in no calc line",
      'action starts with "harkitse"',
      "exclamation mark",
      "verdict or advice word",
      "are not 0 < low <= mid <= high",
      "without claims",
      "is a transfer",
      "is not in the context",
      "struck other",
      "measure series without keys",
      "needs nope",
      "fact no_such_fact",
      "needs_input without a valid input key",
    ]) {
      expect(found).toContain(part);
    }
  });
});
