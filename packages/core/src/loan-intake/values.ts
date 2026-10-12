/**
 * Reading one value out of a piece of text: a euro amount, a percentage or a date, in the forms Finnish banks print.
 * A reader returns null when the text holds no value, two different ones, or a number it cannot place. `clean` says
 * the text held nothing but the value. `doubt` says the value came through a repair or an unusual form (an OCR letter
 * for a digit, a lost comma, a decimal point, a minus, no unit). The caller turns either into `check`.
 *
 * `parseAmount` and `parseDate` of sources/nordea-csv/parser.ts are not used here: they give the value and do not tell
 * the form it was printed in, and the printed form is what decides `sure`.
 */
import { daysInMonth } from "../dates.ts";
import type { IsoDate } from "../types.ts";
import { isLoanOtherUnit, loanMoneyUnit, loanPercentUnit } from "../wording-loan-pages.ts";

export interface Reading<T> {
  value: T;
  clean: boolean;
  doubt: boolean;
}

/** Stands in for a span that was read. It is no letter and no digit, so what is left of a text can be judged. */
const TAKEN = "\u0001";
const blank = (text: string, start: number, end: number) => text.slice(0, start) + TAKEN.repeat(end - start) + text.slice(end);
/** Whether anything readable is left: a word or a number that no reader took. */
export const hasText = (rest: string) => /[\p{L}\p{N}]/u.test(rest);

// ── OCR letters ──

const DIGIT_GROUP = /(?<![\p{L}\p{N}])[0-9OolI]+(?![\p{L}\p{N}])/gu;

/**
 * OCR prints O for 0 and l or I for 1. A group of such characters becomes digits when it holds a real digit ("l2",
 * "5O"), when it is glued to a number by a comma or a point ("O,65"), or when it is the "OOO" after a number and a
 * space. A word made of these letters alone ("olo") is left as it is. The length stays, so positions still match.
 */
export function repairDigits(text: string): { text: string; repaired: boolean } {
  const groups = [...text.matchAll(DIGIT_GROUP)].map((m) => ({ start: m.index, end: m.index + m[0].length, raw: m[0] }));
  const numeric = groups.map((g) => /\d/.test(g.raw));
  groups.forEach((g, i) => {
    if (numeric[i]) return;
    const prev = groups[i - 1];
    const next = groups[i + 1];
    const gapBefore = prev && g.start - prev.end === 1 ? text[prev.end] : undefined;
    const gapAfter = next && next.start - g.end === 1 ? text[g.end] : undefined;
    const glued = (gapBefore !== undefined && /[.,]/.test(gapBefore) && numeric[i - 1]) || (gapAfter !== undefined && /[.,]/.test(gapAfter) && numeric[i + 1]);
    numeric[i] = glued || (/^[Oo]{3}$/.test(g.raw) && gapBefore === " " && numeric[i - 1] === true);
  });
  let out = text;
  groups.forEach((g, i) => {
    if (!numeric[i] || !/[OolI]/.test(g.raw)) return;
    out = out.slice(0, g.start) + g.raw.replace(/[Oo]/g, "0").replace(/[lI]/g, "1") + out.slice(g.end);
  });
  return { text: out, repaired: out !== text };
}

// ── dates ──

const FI_DATE = /(?<![\d.,])(\d{1,2})\. ?(\d{1,2})\. ?(\d{4}|\d{2})(?!\d)/g;
const ISO_DATE = /(?<![\d-])(\d{4})-(\d{2})-(\d{2})(?![\d-])/g;

function isoDate(year: number, month: number, day: number): IsoDate | null {
  if (year < 1900 || year > 2199 || month < 1 || month > 12 || day < 1) return null;
  const ym = `${year}-${String(month).padStart(2, "0")}`;
  return day <= daysInMonth(ym) ? `${ym}-${String(day).padStart(2, "0")}` : null;
}

// ── numbers ──

interface Num {
  raw: string;
  /** The span with its sign, currency and unit, for blanking. */
  from: number;
  to: number;
  unit: "money" | "percent" | "other" | "none";
  negative: boolean;
  /** Part of a word or a code ("FI49", "A4"): no value. */
  glued: boolean;
}
interface FoundDate {
  iso: IsoDate;
  /** A two-digit year, read as 20xx. */
  short: boolean;
}
interface Scan {
  /** The text with OCR digits repaired and the dates blanked. */
  text: string;
  repaired: boolean;
  dates: FoundDate[];
  nums: Num[];
}

/** A run of digits with single spaces, points and commas inside: one number as printed, or two the reader cannot split. */
const CHUNK = /\d(?:[\d .,]*\d)?/g;
const LEAD = /(?<![\p{L}\p{N}])((?:€|EUR) ?)?(- ?)?$/iu;
/** "5 000 200" with no unit and no cents: one amount, or two numbers one space apart. */
const THREE_GROUPS = /^\d{1,3}(?: \d{3}){2,}$/;

function scan(input: string): Scan {
  const fixed = repairDigits(input);
  let text = fixed.text;
  const dates: FoundDate[] = [];
  const spans: [number, number][] = [];
  const found = (iso: IsoDate | null, short: boolean, m: RegExpExecArray) => {
    if (!iso) return;
    dates.push({ iso, short });
    spans.push([m.index, m.index + m[0].length]);
  };
  for (const m of text.matchAll(FI_DATE)) {
    const short = m[3]!.length === 2;
    found(isoDate(Number(m[3]) + (short ? 2000 : 0), Number(m[2]), Number(m[1])), short, m);
  }
  for (const m of text.matchAll(ISO_DATE)) found(isoDate(Number(m[1]), Number(m[2]), Number(m[3])), false, m);
  for (const [start, end] of spans) text = blank(text, start, end);

  const nums: Num[] = [];
  for (const m of text.matchAll(CHUNK)) {
    const end = m.index + m[0].length;
    const before = text.slice(0, m.index);
    const after = text.slice(end);
    const lead = LEAD.exec(before);
    const money = loanMoneyUnit(after);
    const percent = loanPercentUnit(after);
    const hasCurrency = money !== null || Boolean(lead?.[1]);
    nums.push({
      raw: m[0],
      from: m.index - (lead?.[0].length ?? 0),
      to: end + (percent ?? money ?? "").length,
      unit: percent !== null ? "percent" : hasCurrency ? "money" : isLoanOtherUnit(after) ? "other" : "none",
      negative: Boolean(lead?.[2]),
      glued: /[\p{L}\p{N}]$/u.test(before),
    });
  }
  return { text, repaired: fixed.repaired, dates, nums };
}

const withoutNums = (s: Scan) => s.nums.reduce((rest, n) => blank(rest, n.from, n.to), s.text);

/** Above this an amount is no household's loan: two numbers that ran together. */
const MAX_CENTS = 100_000_000_00;

function moneyCents(raw: string): { cents: number; doubt: boolean } | null {
  const whole = (digits: string, decimals: string, doubt: boolean) => {
    const cents = Number(digits.replace(/\D/g, "")) * 100 + Number(decimals.padEnd(2, "0"));
    return cents <= MAX_CENTS ? { cents, doubt } : null;
  };
  let m: RegExpExecArray | null;
  // "0" and then digits with no comma: the comma after the zero was lost ("050" is 0,50)
  if ((m = /^0(\d{2})$/.exec(raw))) return whole("0", m[1]!, true);
  if (/^0\d/.test(raw)) return null;
  // 12 345,67 and 12.345,67 and 12345,67, with or without the cents; one decimal is unusual for money
  if ((m = /^(\d{1,3}(?: \d{3})+|\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{1,2}))?$/.exec(raw))) return whole(m[1]!, m[2] ?? "", m[2]?.length === 1);
  // 1,234.56 and 1234.56: a decimal point is another country's form, or a comma OCR read as a point
  if ((m = /^(\d{1,3}(?:,\d{3})+|\d+)\.(\d{1,2})$/.exec(raw))) return whole(m[1]!, m[2]!, true);
  // 12 345 67: the comma was read as a space
  if ((m = /^(\d{1,3}(?: \d{3})*) (\d{2})$/.exec(raw))) return whole(m[1]!, m[2]!, true);
  return null;
}

function percentBp(raw: string): { bp: number; doubt: boolean } | null {
  // thousandths of a percent first, so 2,675 rounds to 2,68 and not to what a float makes of it
  const bp = (whole: string, decimals: string, doubt: boolean) => ({ bp: Math.round((Number(whole) * 1000 + Number(decimals.padEnd(3, "0"))) / 10), doubt });
  let m: RegExpExecArray | null;
  // "065": the comma after the zero was lost
  if ((m = /^0(\d{1,3})$/.exec(raw))) return bp("0", m[1]!, true);
  if ((m = /^(\d{1,2})(?:,(\d{1,3}))?$/.exec(raw))) return bp(m[1]!, m[2] ?? "", false);
  // 3.25 for 3,25, and "3 25" where the comma was read as a space
  if ((m = /^(\d{1,2})[. ](\d{1,3})$/.exec(raw))) return bp(m[1]!, m[2]!, true);
  return null;
}

/** All the same value, or null. */
function agreed<T extends object>(parsed: (T | null)[], same: (a: T, b: T) => boolean): T[] | null {
  const first = parsed[0];
  return first && parsed.every((p): p is T => p !== null && same(p, first)) ? (parsed as T[]) : null;
}

/**
 * A euro amount in cents, positive. With a unit on any number, every number must have one ("10 000 € 5 vuotta" has
 * no amount the reader can be sure of). `date` is a date beside the amount, taken only when `withDate` asks for it.
 */
export function readMoney(input: string, withDate = false): (Reading<number> & { date?: IsoDate }) | null {
  const s = scan(input);
  if (s.nums.length === 0 || s.dates.length > 1 || s.nums.some((n) => n.glued || n.unit === "percent" || n.unit === "other")) return null;
  const marked = s.nums.filter((n) => n.unit === "money").length;
  if (marked > 0 && marked < s.nums.length) return null;
  const parsed = agreed(s.nums.map((n) => moneyCents(n.raw)), (a, b) => a.cents === b.cents);
  if (!parsed) return null;
  const date = s.dates[0];
  return {
    value: parsed[0]!.cents,
    clean: !hasText(withoutNums(s)) && (!date || withDate),
    doubt: s.repaired || parsed.some((p) => p.doubt) || s.nums.some((n) => n.negative || (n.unit === "none" && THREE_GROUPS.test(n.raw))) || date?.short === true,
    ...(date && withDate ? { date: date.iso } : {}),
  };
}

/** A percentage in hundredths of a percent, positive; `negative` says a minus stood before it. */
export function readPercent(input: string): (Reading<number> & { negative: boolean }) | null {
  const s = scan(input);
  if (s.nums.length === 0 || s.dates.length > 0 || s.nums.some((n) => n.glued || n.unit === "money" || n.unit === "other")) return null;
  const marked = s.nums.filter((n) => n.unit === "percent").length;
  if (marked > 0 && marked < s.nums.length) return null;
  const parsed = agreed(s.nums.map((n) => percentBp(n.raw)), (a, b) => a.bp === b.bp);
  if (!parsed) return null;
  return {
    value: parsed[0]!.bp,
    clean: !hasText(withoutNums(s)),
    // a bare number after a rate label is most likely the rate, but the sign that says so is missing
    doubt: s.repaired || marked === 0 || parsed.some((p) => p.doubt),
    negative: s.nums.some((n) => n.negative),
  };
}

/**
 * The one percentage in a text that may hold other numbers too (the months of "12 kk Euribor 2,737 %"): its signed
 * value, and the text with it and every date blanked.
 */
export function findPercent(input: string): { bp: number; rest: string } | null {
  const s = scan(input);
  const marked = s.nums.filter((n) => n.unit === "percent" && !n.glued);
  const parsed = agreed(marked.map((n) => percentBp(n.raw)), (a, b) => a.bp === b.bp);
  if (!parsed) return null;
  return { bp: marked.some((n) => n.negative) ? -parsed[0]!.bp : parsed[0]!.bp, rest: marked.reduce((rest, n) => blank(rest, n.from, n.to), s.text) };
}

/** A date as `YYYY-MM-DD`: 31.12.2031, 2031-12-31, or 31.12.31 with doubt. A number beside it leaves it unread. */
export function readDate(input: string): Reading<IsoDate> | null {
  const s = scan(input);
  const date = s.dates[0];
  if (!date || s.dates.length > 1 || s.nums.length > 0) return null;
  return { value: date.iso, clean: !hasText(s.text), doubt: s.repaired || date.short };
}

/** A line that is numbers and dates and nothing else: a value with no label of its own. */
export function isValueOnly(input: string): boolean {
  const s = scan(input);
  return s.nums.length + s.dates.length > 0 && !hasText(withoutNums(s));
}
