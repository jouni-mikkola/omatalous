/**
 * The loan form's state and rules, apart from the page so they can be tested: a draft or a saved loan as the texts the
 * inputs hold, which fields a kind of loan has, what is still to check, and the loan the server takes.
 */
import { DEBT_ACCOUNT_TYPES, isRevolving, LOAN_DRAFT_WARNING_TEXT, type Loan, type LoanDraft, type LoanDraftKey, type LoanDraftPaymentKind, type LoanDraftWarning, type LoanKind, loanPeriodInterest } from "@banking/core";
import { ACCOUNT_TYPE_LABEL, eurosText, parseEuros, parseRate, rateText } from "../../format.ts";
import type { Account, LoanProposalRow } from "../../types.ts";
import { KIND_LABEL, type LoanFieldKey } from "./labels.ts";

/** Read as printed, read with doubt, or not in the text. */
type FieldMark = "sure" | "check" | "missing";

/** The fields of a loan the form shows, in the order it shows them. Name and kind stand above them. */
const FIELD_KEYS = ["lender", "balanceCents", "balanceDate", "grantedCents", "limitCents", "rateBp", "reference", "marginBp", "rateReviewDate", "repayment", "intervalMonths", "paymentCents", "endDate"] as const satisfies readonly LoanFieldKey[];

const MONEY_KEYS = ["balanceCents", "grantedCents", "limitCents", "paymentCents"] as const;
const RATE_KEYS = ["rateBp", "marginBp"] as const;

/** What a draft adds to a form: where each value came from. A saved loan has none. */
interface FormSource {
  marks: Record<LoanDraftKey, FieldMark>;
  lines: Partial<Record<LoanFieldKey, string>>;
  warnings: readonly LoanDraftWarning[];
  /** The payment as it was read, to put back when the way of paying fits it again. */
  payment: string;
}

export interface LoanForm {
  /** The id of a saved loan that is being edited. */
  id: string | null;
  /** Not shown, and sent back as it came: PUT replaces every field. */
  seriesKey: string | null;
  name: string;
  kind: LoanKind | "";
  /** What each input holds. */
  values: Record<LoanFieldKey, string>;
  source: FormSource | null;
  /** The fields to check that the household has confirmed or changed. */
  confirmed: readonly LoanFieldKey[];
  /** What the read payment is, until the household types one of its own. */
  paymentKind: LoanDraftPaymentKind | null;
  /** The card or loan account that is this same debt (`Loan.accountId`), or "" for none. */
  accountId: string;
}

export type LoanBody = Omit<Loan, "id">;
export type FormErrors = Partial<Record<LoanFieldKey | "kind", string>>;

const blank = (): Record<LoanFieldKey, string> => ({ lender: "", grantedCents: "", balanceCents: "", balanceDate: "", rateBp: "", reference: "", marginBp: "", rateReviewDate: "", repayment: "", intervalMonths: "", paymentCents: "", endDate: "", limitCents: "" });

function textOf(key: LoanFieldKey, value: string | number | null): string {
  if (value === null) return "";
  if (typeof value === "string") return value;
  if ((MONEY_KEYS as readonly string[]).includes(key)) return eurosText(value);
  if ((RATE_KEYS as readonly string[]).includes(key)) return rateText(value);
  return String(value);
}

/** A form with nothing read: the household types the loan in. */
export function emptyForm(today: string): LoanForm {
  return { id: null, seriesKey: null, name: "", kind: "", values: { ...blank(), balanceDate: today }, source: null, confirmed: [], paymentKind: null, accountId: "" };
}

/**
 * A draft of the parser as a form. `today` is the instance's day: the balance is of that day when the text gives no
 * other, and the field says it was not found.
 */
export function formOfDraft(draft: LoanDraft, today: string): LoanForm {
  const values = blank();
  const marks = {} as Record<LoanDraftKey, FieldMark>;
  const lines: Partial<Record<LoanDraftKey, string>> = {};
  for (const key of FIELD_KEYS) {
    // no text gives the review day of the rate: the household types it
    if (key === "rateReviewDate") continue;
    const field = draft[key];
    marks[key] = field ? field.confidence : "missing";
    if (!field) continue;
    values[key] = textOf(key, field.value);
    lines[key] = field.line;
  }
  const payment = values.paymentCents;
  if (!values.balanceDate) values.balanceDate = today;
  return { id: null, seriesKey: null, name: "", kind: "", values, source: { marks, lines, warnings: draft.warnings, payment }, confirmed: [], paymentKind: draft.paymentKind ?? null, accountId: "" };
}

/**
 * A proposed loan as a form: the payee as the lender, the kind the detector guessed (changeable), the usual payment, a
 * one-month interval and the proposal's series key, which links the saved loan to its payments. The bank rows show
 * neither the balance nor the rate, so those stay empty for the household to type.
 */
export function formOfProposal(proposal: LoanProposalRow, today: string): LoanForm {
  const values = { ...blank(), balanceDate: today, lender: proposal.payee.slice(0, 80), paymentCents: eurosText(proposal.paymentCents), intervalMonths: "1" };
  return { id: null, seriesKey: proposal.key, name: "", kind: proposal.kind, values, source: null, confirmed: [], paymentKind: null, accountId: "" };
}

/** A saved loan as a form, for editing. */
export function formOfLoan(loan: Loan): LoanForm {
  const values = blank();
  for (const key of FIELD_KEYS) values[key] = textOf(key, loan[key] ?? null);
  return { id: loan.id, seriesKey: loan.seriesKey, name: loan.name, kind: loan.kind, values, source: null, confirmed: [], paymentKind: null, accountId: loan.accountId ?? "" };
}

const isCredit = (kind: LoanKind | "") => kind !== "" && isRevolving(kind);

/**
 * The fields the chosen kind has. A card or a credit line has a limit and no repayment plan (the server refuses one);
 * other loans have no limit. A loan paid back at once has no payment. A fixed rate has no review day. Before a kind is
 * chosen every field shows.
 */
export function shownFields(form: LoanForm): LoanFieldKey[] {
  const hidden = new Set<LoanFieldKey>();
  if (form.values.reference === "fixed") hidden.add("rateReviewDate");
  if (isCredit(form.kind)) for (const key of ["grantedCents", "repayment", "intervalMonths", "paymentCents", "endDate"] as const) hidden.add(key);
  else if (form.kind !== "") hidden.add("limitCents");
  if (form.values.repayment === "bullet") hidden.add("paymentCents");
  return FIELD_KEYS.filter((key) => !hidden.has(key));
}

/** The read payment is the whole payment, and the chosen way of paying wants the amortisation alone. */
const wholeUnderEqual = (form: LoanForm) => form.paymentKind === "whole" && form.values.repayment === "equal_principal" && form.values.paymentCents !== "";

export function markOf(form: LoanForm, key: LoanFieldKey): FieldMark | null {
  if (!form.source || key === "rateReviewDate") return null;
  if (key === "paymentCents") {
    if (wholeUnderEqual(form)) return "check";
    // emptied because the text had the amortisation alone
    if (form.paymentKind !== null && form.values.paymentCents === "") return "missing";
  }
  return form.source.marks[key];
}

/** The parser's warnings, and the one about a whole payment exactly while it holds for what the form now says. */
export function warningsOf(form: LoanForm): LoanDraftWarning[] {
  if (!form.source) return [];
  const rest = form.source.warnings.filter((w) => w.id !== "payment_whole");
  if (!wholeUnderEqual(form)) return rest;
  return [...rest, form.source.warnings.find((w) => w.id === "payment_whole") ?? { id: "payment_whole", text: LOAN_DRAFT_WARNING_TEXT.payment_whole, fields: ["paymentCents"] }];
}

/** The shown fields that are still to check: saving waits for them. */
export function checksLeft(form: LoanForm): LoanFieldKey[] {
  return shownFields(form).filter((key) => markOf(form, key) === "check" && !form.confirmed.includes(key));
}

export function toggleConfirmed(form: LoanForm, key: LoanFieldKey, on: boolean): LoanForm {
  const rest = form.confirmed.filter((k) => k !== key);
  return { ...form, confirmed: on ? [...rest, key] : rest };
}

export const setKind = (form: LoanForm, kind: LoanKind | ""): LoanForm => ({ ...form, kind });

/** The parameters of the address the Lainat report links to (`#/settings?linkLoan=…&linkAccount=…`): the editor of that loan opens with that account chosen. */
export const LOAN_LINK_PARAM = { loan: "linkLoan", account: "linkAccount" } as const;

/** A card or loan account a loan can be linked to, with the text the select shows for it. */
interface LinkChoice {
  id: string;
  label: string;
}

/**
 * The accounts the household can say a loan is the same debt as: its own cards and loan accounts, but not one that
 * another saved loan holds, since an account has one loan. `loanId` is the loan being edited, null for a new one.
 * Two accounts of one name are told apart by their kind and card number.
 */
export function linkChoices(accounts: readonly Account[], loans: readonly Loan[], loanId: string | null): LinkChoice[] {
  const held = new Set(loans.filter((l) => l.id !== loanId).map((l) => l.accountId));
  const free = accounts.filter((a) => DEBT_ACCOUNT_TYPES.includes(a.type) && !held.has(a.id));
  return free.map((a) => {
    const twin = free.some((b) => b.id !== a.id && b.name === a.name);
    return { id: a.id, label: twin ? `${a.name} (${[ACCOUNT_TYPE_LABEL[a.type], a.cardMask].filter(Boolean).join(", ")})` : a.name };
  });
}

/**
 * A change the household made to one field. A changed field counts as checked. A payment typed here is the
 * household's own figure. A new way of paying back does to the read payment what the parser does for a text that
 * names that way: a whole payment under Tasalyhennys stays to check, an amortisation alone under any other way is
 * emptied, and a payment that fits stays as read. Neither is worked out of the other.
 */
export function setValue(form: LoanForm, key: LoanFieldKey, text: string): LoanForm {
  let next: LoanForm = { ...toggleConfirmed(form, key, true), values: { ...form.values, [key]: text } };
  if (key === "paymentCents") next = { ...next, paymentKind: null };
  if (key !== "repayment" || form.paymentKind === null || !form.source) return next;
  if (form.paymentKind === "whole") return text === "equal_principal" ? toggleConfirmed(next, "paymentCents", false) : next;
  if (text === "equal_principal") return { ...next, values: { ...next.values, paymentCents: form.source.payment } };
  return text === "" ? next : { ...next, values: { ...next.values, paymentCents: "" } };
}

/** The name a loan gets when the household gives none: its kind and who lent. At most the 80 characters the server takes. */
export function defaultName(kind: LoanKind, lender: string): string {
  const who = lender.trim();
  return (who ? `${KIND_LABEL[kind]}, ${who}` : KIND_LABEL[kind]).slice(0, 80);
}

const MONEY_ERROR = "Anna summa euroina, esimerkiksi 12 500,00.";
const RATE_ERROR = "Anna korko prosentteina, esimerkiksi 3,25.";

/**
 * The loan the form holds, as the server takes it: every field, hidden ones as null. An empty input is null, and so is
 * a zero where the server takes none. The server checks the ranges and answers in Finnish, so only what cannot be read
 * at all is an error here.
 */
export function readForm(form: LoanForm): { body: LoanBody | null; errors: FormErrors } {
  const errors: FormErrors = {};
  const shown = new Set(shownFields(form));
  const text = (key: LoanFieldKey) => (shown.has(key) ? form.values[key].trim() : "");
  const cents = (key: (typeof MONEY_KEYS)[number]): number | null => {
    if (text(key) === "") return null;
    const value = parseEuros(text(key));
    if (value === null || value < 0) errors[key] = MONEY_ERROR;
    return value;
  };
  const rate = (key: (typeof RATE_KEYS)[number]): number | null => {
    if (text(key) === "") return null;
    const value = parseRate(text(key));
    if (value === null) errors[key] = RATE_ERROR;
    return value;
  };
  const positive = (value: number | null) => (value === 0 ? null : value);

  if (form.kind === "") errors.kind = "Valitse laji.";
  if (text("balanceCents") === "") errors.balanceCents = "Anna, paljonko lainaa on jäljellä.";
  const balanceCents = cents("balanceCents");
  if (text("balanceDate") === "") errors.balanceDate = "Valitse päivä.";
  const months = text("intervalMonths");
  const body = {
    name: form.name.trim() || (form.kind === "" ? "" : defaultName(form.kind, text("lender"))),
    kind: form.kind,
    lender: text("lender") || null,
    grantedCents: positive(cents("grantedCents")),
    balanceCents,
    balanceDate: text("balanceDate"),
    rateBp: rate("rateBp"),
    reference: text("reference") || null,
    marginBp: rate("marginBp"),
    // a fixed rate has no review day: the field is not shown then, so whatever was typed in it is not sent
    rateReviewDate: text("rateReviewDate") || null,
    repayment: text("repayment") || null,
    intervalMonths: months === "" ? null : Number(months),
    paymentCents: positive(cents("paymentCents")),
    endDate: text("endDate") || null,
    limitCents: positive(cents("limitCents")),
    seriesKey: form.seriesKey,
    // PUT replaces every field, so a body without the link removes the one that was there (the server reads it as null)
    ...(form.accountId ? { accountId: form.accountId } : {}),
  };
  return Object.keys(errors).length > 0 ? { body: null, errors } : { body: body as LoanBody, errors };
}

/**
 * The interest of one interval when the payment is smaller than it, else null. The server refuses such a loan (the
 * balance would grow), with core's `loanPeriodInterest` as here, so the form tells before saving and offers the way
 * out: an empty payment keeps the balance as it is.
 */
export function interestOverPayment(form: LoanForm): number | null {
  const v = form.values;
  if (isCredit(form.kind) || (v.repayment !== "annuity" && v.repayment !== "fixed_instalment") || v.intervalMonths === "") return null;
  const balance = parseEuros(v.balanceCents.trim());
  const rate = parseRate(v.rateBp.trim());
  const payment = parseEuros(v.paymentCents.trim());
  if (balance === null || balance < 0 || rate === null || payment === null || payment <= 0) return null;
  const interest = loanPeriodInterest(balance, rate, Number(v.intervalMonths));
  return payment < interest ? interest : null;
}
