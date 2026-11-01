/**
 * The bank dialect's word lists as data (ADR 0008): `wordlists.json` holds them, `wordlists.schema.json` is their
 * schema, and this is the one typed door. The JSON is a static import, so the same code runs on Node and in the
 * browser and core reads no file. The matching stays in wording.ts and its siblings; a list here is only the
 * alternatives of a regex, joined as they were written before they moved.
 */
import raw from "./wordlists.json" with { type: "json" };

export type FormUse = "strip" | "payee";

interface WordLists {
  alternations: Readonly<Record<string, { about: string; alternatives: readonly string[]; sources?: Readonly<Record<string, string>> }>>;
  companyForms: Readonly<Record<string, readonly FormUse[]>>;
  gamblingMcc: readonly number[];
}

// The shape is held by the schema test (packages/core/test/wordlists.test.ts), so the cast here is checked on every run.
const data = raw as WordLists;

type AlternationName = keyof typeof raw.alternations;

/** The alternatives of a list joined as a regex alternation: the string the constants of wording.ts held. */
export const alternation = (name: AlternationName): string => data.alternations[name]!.alternatives.join("|");

/** The alternatives of a list, one string each. */
export const alternatives = (name: AlternationName): readonly string[] => data.alternations[name]!.alternatives;

export const COMPANY_FORMS: Readonly<Record<string, readonly FormUse[]>> = data.companyForms;
export const GAMBLING_MCC_CODES: readonly number[] = data.gamblingMcc;
