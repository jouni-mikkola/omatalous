/**
 * Finnish bank and company wording that more than one module matches on. It lives here so a new form or a new
 * payment name is added once. Texts are matched folded (see `fold` in merchant.ts), so everything is upper case
 * and has no Ä, Å, Ö or Ü.
 */

/**
 * The texts that mark a MobilePay or Pivo payment, as a regex alternation. Callers add what they need around it
 * ("SIIRTO HENKILOLLE" for money out, "SIIRTO HENKILOLTA" for money in) and the word boundaries that suit them.
 */
export const MOBILEPAY_WORDS = "MOBILEPAY|MOBILE PAY|PIVO";

/**
 * What a company form is used for. The lists differ on purpose: a short form such as SA, SE or AS is also a
 * person's name, so a payee is not a business only because of it, but a name that contains one is still not a
 * person when it is paid by MobilePay.
 *   strip:  dropped from a trade register name to get the bare company name
 *   payee:  a payee that starts or ends with it is a business, so its name may go to the register
 *   person: a MobilePay payee whose name contains it is a company, not a person
 */
export type FormUse = "strip" | "payee" | "person";

const ALL: readonly FormUse[] = ["strip", "payee", "person"];

const FORMS: Readonly<Record<string, readonly FormUse[]>> = {
  OY: ALL,
  OYJ: ALL,
  AB: ALL,
  KY: ALL,
  AY: ALL,
  RY: ALL,
  TMI: ALL,
  OSK: ALL,
  KOY: ALL,
  LTD: ALL,
  ABP: ["strip", "payee"],
  RF: ["strip"],
  AOY: ["strip"],
  AS: ["strip", "person"],
  SR: ["strip", "person"],
  LIMITED: ["payee", "person"],
  INC: ["payee", "person"],
  GMBH: ["payee", "person"],
  LLC: ["payee", "person"],
  PLC: ["payee", "person"],
  BV: ["payee", "person"],
  ASA: ["payee", "person"],
  SA: ["person"],
  SE: ["person"],
  NV: ["person"],
  OU: ["person"],
};

/** The company forms one use trusts. */
export function companyForms(use: FormUse): ReadonlySet<string> {
  return new Set(Object.keys(FORMS).filter((form) => FORMS[form]!.includes(use)));
}
