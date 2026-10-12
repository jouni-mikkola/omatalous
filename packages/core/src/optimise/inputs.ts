/**
 * The numbers a household may type in for Optimoi. Each unlocks a comparison the bank history cannot make alone, and
 * goes stale after a time: a stale input counts as missing, so no euro figure stands on an old number. The server
 * validates every value with `parseInputValue` before it stores it (`optimise_inputs`).
 */
import { addMonthsToDate, dayNumber, fromDayNumber } from "../dates.ts";
import { formatFiDate } from "../analysis/format.ts";
import type { IsoDate } from "../types.ts";
import { isSubject } from "./common.ts";
import type { InputKey, InputValue, InputValueMap, InputValues, LoanReference, StoredInput } from "./types.ts";

export type InputKind = "integer" | "cents" | "date" | "choice" | "loan_rate";

export interface InputDef {
  key: InputKey;
  /** Finnish field label. */
  label: string;
  kind: InputKind;
  /** integer, cents and the margin of loan_rate: inclusive bounds. Cents for money, hundredths of a percent for a margin. */
  min?: number;
  max?: number;
  /** date: inclusive bounds in months from today (−36 = three years ago). */
  minMonths?: number;
  maxMonths?: number;
  /** choice, and the reference rate of loan_rate. */
  choices?: readonly { id: string; label: string }[];
  /** Shown after the field: "kWh vuodessa". Money is typed in euros and stored in cents. */
  unit?: string;
  /** Days after it was saved that the value counts as missing; "date" when its own date has passed; null never. */
  staleAfterDays: number | "date" | null;
  /** The key carries a subject: `insurance_quote:<series id>`. */
  perSubject: boolean;
}

/** The Finnish name of each reference rate: the one list every page and finding reads. */
export const LOAN_REFERENCE_LABEL: Record<LoanReference, string> = {
  euribor_12: "12 kuukauden Euribor",
  euribor_6: "6 kuukauden Euribor",
  euribor_3: "3 kuukauden Euribor",
  fixed: "Kiinteä korko",
};

const LOAN_REFERENCES = (Object.keys(LOAN_REFERENCE_LABEL) as LoanReference[]).map((id) => ({ id, label: LOAN_REFERENCE_LABEL[id] }));

export const INPUT_DEFS: { readonly [K in InputKey]: InputDef & { key: K } } = {
  loan_rate: {
    key: "loan_rate",
    label: "Asuntolainan korko",
    kind: "loan_rate",
    min: 0,
    max: 500,
    choices: LOAN_REFERENCES,
    staleAfterDays: 365,
    perSubject: false,
  },
  electricity_kwh: {
    key: "electricity_kwh",
    label: "Sähkön kulutus",
    kind: "integer",
    min: 500,
    max: 60_000,
    unit: "kWh vuodessa",
    staleAfterDays: 395,
    perSubject: false,
  },
  electricity_contract_end: {
    key: "electricity_contract_end",
    label: "Sähkösopimus päättyy",
    kind: "date",
    minMonths: 0,
    maxMonths: 36,
    staleAfterDays: "date",
    perSubject: false,
  },
  housing_type: {
    key: "housing_type",
    label: "Asumismuoto",
    kind: "choice",
    choices: [
      { id: "kerrostalo", label: "Kerrostalo" },
      { id: "rivitalo", label: "Rivitalo" },
      { id: "omakotitalo", label: "Omakotitalo" },
      { id: "vuokra", label: "Vuokra-asunto" },
      { id: "asumisoikeus", label: "Asumisoikeusasunto" },
    ],
    staleAfterDays: 1095,
    perSubject: false,
  },
  moved_on: {
    key: "moved_on",
    label: "Muuttopäivä",
    kind: "date",
    minMonths: -36,
    maxMonths: 0,
    staleAfterDays: null,
    perSubject: false,
  },
  insurance_quote: {
    key: "insurance_quote",
    label: "Vakuutustarjous",
    kind: "cents",
    min: 100,
    max: 1_000_000,
    unit: "€ vuodessa",
    staleAfterDays: 180,
    perSubject: true,
  },
  parking_permit_price: {
    key: "parking_permit_price",
    label: "Asukaspysäköintitunnus",
    kind: "cents",
    min: 100,
    max: 200_000,
    unit: "€ vuodessa",
    staleAfterDays: 365,
    perSubject: false,
  },
  car_km: {
    key: "car_km",
    label: "Ajomäärä",
    kind: "integer",
    min: 1_000,
    max: 100_000,
    unit: "km vuodessa",
    staleAfterDays: 365,
    perSubject: false,
  },
};

const INPUT_KEYS = Object.keys(INPUT_DEFS) as InputKey[];

/** The definition and subject of a stored key, or null for a key no definition allows. */
export function inputDefOf(key: string): { def: InputDef; subject: string | null } | null {
  const at = key.indexOf(":");
  const base = at < 0 ? key : key.slice(0, at);
  const subject = at < 0 ? null : key.slice(at + 1);
  const def = INPUT_KEYS.includes(base as InputKey) ? INPUT_DEFS[base as InputKey] : null;
  if (!def || def.perSubject !== (subject !== null) || (subject !== null && !isSubject(subject))) return null;
  return { def, subject };
}

/** The stored key of an input: `car_km`, `insurance_quote:<series id>`. */
export function inputKey(def: InputKey, subject?: string | null): string {
  return subject ? `${def}:${subject}` : def;
}

export type ParsedInput = { ok: true; value: InputValue } | { ok: false; error: string };

const num = new Intl.NumberFormat("fi-FI", { maximumFractionDigits: 2 });
const isRealDate = (v: unknown): v is IsoDate => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && fromDayNumber(dayNumber(v)) === v;
const inRange = (v: unknown, def: InputDef): v is number => Number.isSafeInteger(v) && (v as number) >= def.min! && (v as number) <= def.max!;
const dateBounds = (def: InputDef, today: IsoDate): [IsoDate, IsoDate] => [addMonthsToDate(today, def.minMonths!), addMonthsToDate(today, def.maxMonths!)];

/**
 * The server's validator: the value of `def` from the request body, or a Finnish error for a 400. Money comes in
 * cents and a margin in hundredths of a percent, so nothing here parses a decimal. `today` bounds the dates.
 */
export function parseInputValue(def: InputDef, raw: unknown, today: IsoDate): ParsedInput {
  switch (def.kind) {
    case "integer":
      return inRange(raw, def) ? { ok: true, value: raw } : { ok: false, error: `Anna kokonaisluku väliltä ${num.format(def.min!)}–${num.format(def.max!)}.` };
    case "cents":
      return inRange(raw, def) ? { ok: true, value: raw } : { ok: false, error: `Anna summa väliltä ${num.format(def.min! / 100)}–${num.format(def.max! / 100)} €.` };
    case "date": {
      const [from, to] = dateBounds(def, today);
      return isRealDate(raw) && raw >= from && raw <= to ? { ok: true, value: raw } : { ok: false, error: `Anna päivämäärä väliltä ${formatFiDate(from)}–${formatFiDate(to)}.` };
    }
    case "choice":
      return typeof raw === "string" && def.choices!.some((c) => c.id === raw) ? { ok: true, value: raw as InputValue } : { ok: false, error: "Valitse yksi vaihtoehdoista." };
    case "loan_rate": {
      const o = raw as Record<string, unknown> | null;
      const ok =
        typeof o === "object" &&
        o !== null &&
        !Array.isArray(o) &&
        Object.keys(o).sort().join(",") === "marginBp,reference" &&
        inRange(o.marginBp, def) &&
        def.choices!.some((c) => c.id === o.reference);
      return ok
        ? { ok: true, value: { marginBp: o.marginBp as number, reference: o.reference as InputValueMap["loan_rate"]["reference"] } }
        : { ok: false, error: `Anna marginaali väliltä ${num.format(def.min! / 100)}–${num.format(def.max! / 100)} % ja valitse viitekorko.` };
    }
  }
}

/** The stored value still has the shape of its kind; a value from an older version that does not is ignored. */
function hasShape(def: InputDef, value: unknown): boolean {
  switch (def.kind) {
    case "integer":
    case "cents":
      return Number.isSafeInteger(value);
    case "date":
      return isRealDate(value);
    case "choice":
      return def.choices!.some((c) => c.id === value);
    case "loan_rate": {
      const o = value as Partial<InputValueMap["loan_rate"]> | null;
      return typeof o === "object" && o !== null && Number.isSafeInteger(o.marginBp) && def.choices!.some((c) => c.id === o.reference);
    }
  }
}

/** Past its age, or for a date input past its own date. */
export function isStale(def: InputDef, stored: StoredInput, today: IsoDate): boolean {
  if (def.staleAfterDays === null) return false;
  if (def.staleAfterDays === "date") return typeof stored.value === "string" && stored.value < today;
  return dayNumber(today) - dayNumber(stored.asOf) > def.staleAfterDays;
}

export type InputStatus = { state: "missing" } | { state: "stale" | "ok"; stored: StoredInput };

/** Whether the user gave the input, and whether it still counts. */
export function inputStatus(values: InputValues, key: string, today: IsoDate): InputStatus {
  const found = inputDefOf(key);
  const stored = values[key];
  if (!found || !stored || !hasShape(found.def, stored.value)) return { state: "missing" };
  return { state: isStale(found.def, stored, today) ? "stale" : "ok", stored };
}

/** The typed value of an input, or null when it is missing or stale (a stale input counts as missing). */
export function valueOf<K extends InputKey>(values: InputValues, key: K, today: IsoDate, subject?: string): InputValueMap[K] | null {
  const status = inputStatus(values, inputKey(key, subject), today);
  return status.state === "ok" ? (status.stored.value as InputValueMap[K]) : null;
}
