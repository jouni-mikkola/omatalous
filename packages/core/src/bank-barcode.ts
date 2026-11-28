/**
 * The Finnish bank barcode (pankkiviivakoodi) of a paper or PDF bill, read from its 54 digits. Version 4 carries a
 * Finnish reference, version 5 an international RF reference. Layout (Finanssiala's guide): version 1, the 16 digits of
 * the Finnish IBAN after "FI" 16, euros 6, cents 2, then for version 4 three reserve digits and a 20 digit reference,
 * for version 5 the two RF check digits and 21 reference digits, and the due date as YYMMDD (000000 = none) 6.
 * A sum of zero means the payer chooses it or it is over 999 999,99 €.
 * https://www.finanssiala.fi/wp-content/uploads/2021/03/Pankkiviivakoodi-opas.pdf
 */
import { dayNumber, fromDayNumber } from "./dates.ts";

export type BarcodeFailure = "length" | "version" | "iban" | "reference" | "date";

export type BankBarcode = {
  version: 4 | 5;
  iban: string;
  cents: number;
  reference: string;
  /** Null when the bill names no due date. */
  dueDate: string | null;
};

export type BarcodeResult = { ok: true; barcode: BankBarcode } | { ok: false; failure: BarcodeFailure };

const LENGTH = 54;

/** The remainder of a long digit string modulo 97, as ISO 7064 asks for IBAN and RF references. */
function mod97(digits: string): number {
  let rest = 0;
  for (const ch of digits) rest = (rest * 10 + Number(ch)) % 97;
  return rest;
}

/** The check digit of a Finnish reference: weights 7, 3, 1 from the right, the sum rounded up to ten. */
function finnishReferenceValid(reference: string): boolean {
  if (reference.length < 4) return false;
  const body = reference.slice(0, -1);
  const weights = [7, 3, 1];
  let sum = 0;
  for (let i = 0; i < body.length; i++) sum += Number(body[body.length - 1 - i]) * (weights[i % 3] ?? 0);
  return (10 - (sum % 10)) % 10 === Number(reference.slice(-1));
}

function dateOf(yymmdd: string): string | null | undefined {
  if (yymmdd === "000000") return null;
  const iso = `20${yymmdd.slice(0, 2)}-${yymmdd.slice(2, 4)}-${yymmdd.slice(4, 6)}`;
  return fromDayNumber(dayNumber(iso)) === iso ? iso : undefined;
}

/** Reads a pasted barcode; spaces are ignored. A wrong one names what failed and gives no partial values. */
export function parseBankBarcode(text: string): BarcodeResult {
  const s = text.replace(/\s+/g, "");
  if (!/^\d+$/.test(s) || s.length !== LENGTH) return { ok: false, failure: "length" };
  const version = s[0] === "4" ? 4 : s[0] === "5" ? 5 : null;
  if (version === null) return { ok: false, failure: "version" };

  const ibanDigits = s.slice(1, 17);
  if (mod97(`${ibanDigits.slice(2)}1518${ibanDigits.slice(0, 2)}`) !== 1) return { ok: false, failure: "iban" };

  let reference: string;
  if (version === 4) {
    reference = s.slice(28, 48).replace(/^0+/, "");
    if (!finnishReferenceValid(reference)) return { ok: false, failure: "reference" };
  } else {
    const check = s.slice(25, 27);
    const body = s.slice(27, 48).replace(/^0+/, "");
    if (body === "" || mod97(`${body}2715${check}`) !== 1) return { ok: false, failure: "reference" };
    reference = `RF${check}${body}`;
  }

  const dueDate = dateOf(s.slice(48, 54));
  if (dueDate === undefined) return { ok: false, failure: "date" };

  const cents = Number(s.slice(17, 23)) * 100 + Number(s.slice(23, 25));
  return { ok: true, barcode: { version, iban: `FI${ibanDigits}`, cents, reference, dueDate } };
}
