import { describe, expect, it } from "vitest";
import raw from "../src/wordlists.json" with { type: "json" };
import schema from "../src/wordlists.schema.json" with { type: "json" };
import { alternation } from "../src/wordlists.ts";
import { MOBILEPAY_WORDS, REFUND_WORDS } from "../src/wording.ts";
import { CARD_CASH_WORDS } from "../src/wording-moves.ts";
import { GAMBLING_MCC } from "../src/wording-gambling.ts";

const isObject = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);

/** The problems of a word list file, empty when it is sound: the schema of wordlists.schema.json as code, plus what a schema cannot say (the alternatives must compile as a regex). */
function wordListProblems(data: unknown): string[] {
  const problems: string[] = [];
  if (!isObject(data)) return ["the file is not an object"];
  for (const key of Object.keys(data)) if (!["$schema", "alternations", "companyForms", "gamblingMcc"].includes(key)) problems.push(`unknown key ${key}`);
  const checkUnique = (where: string, items: readonly unknown[]) => {
    if (new Set(items).size !== items.length) problems.push(`${where}: a duplicate entry`);
  };
  if (!isObject(data.alternations)) problems.push("alternations is not an object");
  else {
    for (const [name, list] of Object.entries(data.alternations)) {
      if (!/^[A-Z][A-Z0-9_]*$/.test(name)) problems.push(`${name}: the name is not UPPER_SNAKE_CASE`);
      if (!isObject(list)) { problems.push(`${name}: not an object`); continue; }
      for (const key of Object.keys(list)) if (!["about", "alternatives", "sources"].includes(key)) problems.push(`${name}: unknown key ${key}`);
      if (typeof list.about !== "string" || !list.about) problems.push(`${name}: about is missing`);
      const alternatives = list.alternatives;
      if (!Array.isArray(alternatives) || !alternatives.length) { problems.push(`${name}: alternatives is empty or not a list`); continue; }
      if (alternatives.some((a) => typeof a !== "string" || !a)) { problems.push(`${name}: an alternative is not a non-empty string`); continue; }
      checkUnique(name, alternatives);
      try {
        new RegExp(`(?:${alternatives.join("|")})`);
      } catch {
        problems.push(`${name}: the alternatives are not a regular expression`);
      }
      if (list.sources !== undefined) {
        if (!isObject(list.sources)) problems.push(`${name}: sources is not an object`);
        else for (const [alt, why] of Object.entries(list.sources)) {
          if (!alternatives.includes(alt)) problems.push(`${name}: a source for "${alt}", which is not an alternative`);
          if (typeof why !== "string" || !why) problems.push(`${name}: the source of "${alt}" is empty`);
        }
      }
    }
  }
  if (!isObject(data.companyForms)) problems.push("companyForms is not an object");
  else {
    for (const [form, uses] of Object.entries(data.companyForms)) {
      if (!/^[A-Z]+$/.test(form)) problems.push(`form ${form}: not upper case letters`);
      if (!Array.isArray(uses) || !uses.length || uses.some((u) => u !== "strip" && u !== "payee")) problems.push(`form ${form}: uses are not strip or payee`);
      else checkUnique(`form ${form}`, uses);
    }
  }
  const mcc = data.gamblingMcc;
  if (!Array.isArray(mcc) || !mcc.length || mcc.some((c) => !Number.isInteger(c) || c < 1000 || c > 9999)) problems.push("gamblingMcc is not a list of four digit codes");
  else checkUnique("gamblingMcc", mcc);
  return problems;
}

const copy = () => structuredClone(raw) as Record<string, any>;

describe("word lists as data (ADR 0008)", () => {
  it("the shipped file is sound", () => {
    expect(wordListProblems(raw)).toEqual([]);
  });

  it("the schema names the same keys the checker reads", () => {
    expect(Object.keys(schema.properties).sort()).toEqual(["$schema", "alternations", "companyForms", "gamblingMcc"]);
    expect([...schema.required].sort()).toEqual(["alternations", "companyForms", "gamblingMcc"]);
    expect(Object.keys(schema.properties.alternations.additionalProperties.properties).sort()).toEqual(["about", "alternatives", "sources"]);
  });

  it("the schema holds the rules the checker enforces", () => {
    const alt = schema.properties.alternations.additionalProperties;
    expect(alt.required).toEqual(["about", "alternatives"]);
    expect(alt.properties.alternatives).toMatchObject({ minItems: 1, uniqueItems: true, items: { type: "string", minLength: 1 } });
    expect(new RegExp(schema.properties.alternations.propertyNames.pattern).test("REFUND_WORDS")).toBe(true);
    expect(new RegExp(schema.properties.alternations.propertyNames.pattern).test("refund")).toBe(false);
    expect(schema.properties.companyForms.additionalProperties.items.enum).toEqual(["strip", "payee"]);
    expect(schema.properties.gamblingMcc).toMatchObject({ minItems: 1, uniqueItems: true, items: { type: "integer", minimum: 1000, maximum: 9999 } });
  });

  it.each([
    ["an empty list", (d: any) => { d.alternations.MOBILEPAY_WORDS.alternatives = []; }, "MOBILEPAY_WORDS: alternatives is empty"],
    ["an empty alternative", (d: any) => { d.alternations.MOBILEPAY_WORDS.alternatives.push(""); }, "not a non-empty string"],
    ["a duplicate", (d: any) => { d.alternations.REFUND_WORDS.alternatives.push("HYVITYS"); }, "REFUND_WORDS: a duplicate entry"],
    ["a broken pattern", (d: any) => { d.alternations.REFUND_WORDS.alternatives.push("(OPEN"); }, "not a regular expression"],
    ["a missing description", (d: any) => { delete d.alternations.REFUND_WORDS.about; }, "REFUND_WORDS: about is missing"],
    ["a lower case name", (d: any) => { d.alternations.refund = d.alternations.REFUND_WORDS; }, "refund: the name is not UPPER_SNAKE_CASE"],
    ["an unknown key", (d: any) => { d.alternations.REFUND_WORDS.extra = 1; }, "REFUND_WORDS: unknown key extra"],
    ["a source for no alternative", (d: any) => { d.alternations.GAMBLING_LICENSED.sources.NOPE = "x"; }, "which is not an alternative"],
    ["a form with no use", (d: any) => { d.companyForms.OY = ["wear"]; }, "form OY"],
    ["a merchant code of three digits", (d: any) => { d.gamblingMcc.push(780); }, "gamblingMcc"],
    ["a missing section", (d: any) => { delete d.companyForms; }, "companyForms is not an object"],
  ])("fails on %s", (_name, mutate, expected) => {
    const data = copy();
    mutate(data);
    expect(wordListProblems(data).join("; ")).toContain(expected);
  });

  it("joins the alternatives as the constants were written before they moved", () => {
    expect(MOBILEPAY_WORDS).toBe("MOBILEPAY|MOBILE PAY|PIVO|VIPPS MOBILEPAY|VIPPS");
    expect(REFUND_WORDS).toBe("HYVITYS|PALAUTUS|REFUND|ATERBETALNING|CHARGEBACK|OIKAISU|LIIKASUORITUS|YLISUORITUS");
    expect(CARD_CASH_WORDS).toBe("KORTTIMAKSU ?/ ?NOSTO|KORTTIMAKSU NOSTO|KORTTIOSTO ?/ ?NOSTO");
    expect(alternation("ELECTRICITY_SELLER_WORDS")).toContain("|\\bVARE\\b|");
    expect(GAMBLING_MCC).toEqual([7800, 7801, 7802, 7995, 9406]);
  });
});
