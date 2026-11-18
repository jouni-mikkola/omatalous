/**
 * The loan form's state and rules, apart from the page so they can be tested: a read, new or saved loan as the texts
 * the inputs hold, which fields a kind of loan has, what is still to check, and the loan the server takes.
 */
import { balanceDayOf, DEBT_ACCOUNT_TYPES, euriborRateBp, type Fixings, type InferredLoanTerms, isRevolving, type Loan, type LoanDraft, type LoanDraftKey, type LoanDraftLastPayment, type LoanDraftPaymentKind, type LoanKind, loanPeriodInterest } from "@banking/core";
import { ACCOUNT_TYPE_LABEL, eurosText, parseEuros, parseRate, rateText } from "../../format.ts";
import { t } from "../../text.ts";
import type { Account, LoanProposalRow } from "../../types.ts";
import { KIND_LABEL, type LoanFieldKey } from "./labels.ts";

/** The fields of a loan the form shows, in the order it shows them. Name and kind stand above them. */
const FIELD_KEYS = ["lender", "balanceCents", "balanceDate", "grantedCents", "limitCents", "rateBp", "reference", "marginBp", "rateReviewDate", "repayment", "intervalMonths", "paymentCents", "endDate"] as const satisfies readonly LoanFieldKey[];

/** The form's own text of the loan's payment, read by key like every other field of the form. */
const PAYMENT: LoanFieldKey = "paymentCents";
const MONEY_KEYS = ["balanceCents", "grantedCents", "limitCents", "paymentCents"] as const;
const RATE_KEYS = ["rateBp", "marginBp"] as const;

/** Read as printed, read with doubt, or not in the text. */
type FieldMark = "sure" | "check" | "missing";

/** The draft field each form field is read from: the loan's payment is the draft's `instalmentCents`. */
const DRAFT_KEY: Record<LoanFieldKey, Exclude<LoanDraftKey, "contractDate" | "lastPayment">> = {
  lender: "lender", balanceCents: "balanceCents", balanceDate: "balanceDate", grantedCents: "grantedCents", limitCents: "limitCents", rateBp: "rateBp", reference: "reference", marginBp: "marginBp",
  rateReviewDate: "rateReviewDate", repayment: "repayment", intervalMonths: "intervalMonths", paymentCents: "instalmentCents", endDate: "endDate",
};

/** What a read draft adds to a form: where each value came from. A saved loan and a typed one have none. */
interface FormSource {
  marks: Partial<Record<LoanFieldKey, FieldMark>>;
  /** The source line each value was read from. */
  lines: Partial<Record<LoanFieldKey, string>>;
  /** Why a field is to check, when a figure of the text does not fit another (the reader's sentences). */
  warnings: Partial<Record<LoanFieldKey, string[]>>;
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
  /** The split of the last payment the document read states with confidence: sent with the save, which keeps it with the loan. Null: the read has none, or has it to check. */
  lastPayment: LoanDraftLastPayment | null;
}

export type LoanBody = Omit<Loan, "id"> & { lastPayment?: LoanDraftLastPayment };
export type FormErrors = Partial<Record<LoanFieldKey | "kind", string>>;

const blank = (): Record<LoanFieldKey, string> => ({ lender: "", grantedCents: "", balanceCents: "", balanceDate: "", rateBp: "", reference: "", marginBp: "", rateReviewDate: "", repayment: "", intervalMonths: "", paymentCents: "", endDate: "", limitCents: "" });

function textOf(key: LoanFieldKey, value: string | number | null): string {
  if (value === null) return "";
  if (typeof value === "string") return value;
  if ((MONEY_KEYS as readonly string[]).includes(key)) return eurosText(value);
  if ((RATE_KEYS as readonly string[]).includes(key)) return rateText(value);
  return String(value);
}

/** An empty form: the household types the loan in. */
export function emptyForm(today: string): LoanForm {
  return { id: null, seriesKey: null, name: "", kind: "", values: { ...blank(), balanceDate: today }, source: null, confirmed: [], paymentKind: null, accountId: "", lastPayment: null };
}

/**
 * A draft of the text reader as a form. Every field the text gave is marked read as printed or to check, and carries its
 * source line; a field it did not give stays empty and is marked not found, never a zero. `today` is the instance's day:
 * the balance is of that day when the text gives no other. `base` is the form the text is read into: a form of a
 * proposal or of a saved loan (the same debt read again) keeps its name, series and account, and a field the text lacks
 * keeps its value, so a field the text read wins over the one the bank rows gave.
 */
export function formOfDraft(draft: LoanDraft, today: string, base: LoanForm = emptyForm(today)): LoanForm {
  const values = { ...base.values };
  const marks: FormSource["marks"] = {};
  const lines: FormSource["lines"] = {};
  for (const key of FIELD_KEYS) {
    const field = draft[DRAFT_KEY[key]];
    if (!field) {
      if (values[key] === "") marks[key] = "missing";
      continue;
    }
    marks[key] = field.confidence;
    values[key] = textOf(key, field.value);
    lines[key] = field.line;
  }
  const warnings: FormSource["warnings"] = {};
  for (const warning of draft.warnings) {
    for (const key of FIELD_KEYS) if (warning.fields.includes(DRAFT_KEY[key])) (warnings[key] ??= []).push(warning.text);
  }
  if (draft.balanceCents && !draft.balanceDate) {
    values.balanceDate = today;
    marks.balanceDate = "missing";
  }
  const payment = values[PAYMENT];
  // the text gave the amortisation alone of a loan whose payment holds the interest: the household types the whole payment
  if (draft.paymentKind === "amortisation" && values.repayment !== "equal_principal") values.paymentCents = "";
  // a fresh read starts with nothing confirmed: what the household confirmed in an earlier read is not this read's
  return { ...base, kind: base.kind || (draft.kind ?? ""), values, source: { marks, lines, warnings, payment }, confirmed: [], paymentKind: draft.paymentKind ?? null, lastPayment: draft.lastPayment?.confidence === "sure" ? draft.lastPayment.value : null };
}

/**
 * A proposed loan as a form: the payee as the lender, the kind the detector guessed (changeable), the usual payment, a
 * one-month interval and the proposal's series key, which links the saved loan to its payments. `terms` is what the
 * rows tell of the loan: the latest payment and its interval, the way of paying back and the euribor with its next
 * review day where the payment steps show them, and the due day of the latest payment as the balance date, so the
 * balance typed is the one after it and the plan keeps the bank's due day. The bank rows show neither the balance nor
 * the rate, so those stay empty for the household to type, except where one connected loan account is held by no saved
 * loan: that account is the same debt, so it is chosen, and the balance is what the bank tells on it (as an amount owed,
 * on the day it told it). With none, several, or one that tells no debt: as without.
 */
export function formOfProposal(proposal: LoanProposalRow, today: string, accounts: readonly Account[] = [], loans: readonly Loan[] = [], terms: InferredLoanTerms | null = null): LoanForm {
  const values = { ...blank(), balanceDate: today, lender: proposal.payee.slice(0, 80), paymentCents: eurosText(proposal.paymentCents), intervalMonths: "1" };
  if (terms) {
    Object.assign(values, {
      paymentCents: eurosText(terms.paymentCents),
      intervalMonths: terms.intervalMonths === null ? values.intervalMonths : String(terms.intervalMonths),
      repayment: terms.repayment ?? "",
      reference: terms.reference ?? "",
      rateReviewDate: terms.nextReview ?? "",
      balanceDate: terms.dueDate < today ? terms.dueDate : today,
    });
  }
  const free = freeAccounts(accounts, loans, null).filter((a) => a.type === "loan");
  const told = free.length === 1 && free[0]!.balanceCents !== null && free[0]!.balanceCents < 0 ? free[0]! : null;
  if (told) Object.assign(values, { balanceCents: eurosText(-told.balanceCents!), balanceDate: balanceDayOf(told.balanceAt, today) });
  return { id: null, seriesKey: proposal.key, name: "", kind: proposal.kind, values, source: null, confirmed: [], paymentKind: null, accountId: told?.id ?? "", lastPayment: null };
}

/**
 * A connected card or credit line no saved loan holds, as the form of a new loan linked to it: the account's name, the
 * balance the bank tells as an amount owed on the day it told it, and its limit. The household types the terms.
 */
export function formOfCard(account: Account, today: string): LoanForm {
  const owed = Math.max(0, -(account.balanceCents ?? 0));
  const limit = account.creditLimitCents;
  const values = { ...blank(), balanceCents: eurosText(owed), balanceDate: balanceDayOf(account.balanceAt, today), limitCents: limit === null ? "" : eurosText(limit) };
  return { id: null, seriesKey: null, name: account.name, kind: account.type === "credit_card" ? "card" : "credit_line", values, source: null, confirmed: [], paymentKind: null, accountId: account.id, lastPayment: null };
}

/** A saved loan as a form, for editing. */
export function formOfLoan(loan: Loan): LoanForm {
  const values = blank();
  for (const key of FIELD_KEYS) values[key] = textOf(key, loan[key] ?? null);
  return { id: loan.id, seriesKey: loan.seriesKey, name: loan.name, kind: loan.kind, values, source: null, confirmed: [], paymentKind: null, accountId: loan.accountId ?? "", lastPayment: null };
}

/** The words of a lender's name, lower case, so "Esimerkki Pankki Oyj" and "esimerkki pankki oyj." are one lender. */
const lenderWords = (name: string): string => name.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean).sort().join(" ");

/**
 * The saved loan a read loan is the same debt as: the same series, else the same lender words and the same granted
 * amount. Anything else is a new loan. A form with no lender or no granted amount matches by series alone.
 */
export function matchedLoan(form: LoanForm, loans: readonly Loan[]): Loan | null {
  const granted = parseEuros(form.values.grantedCents.trim());
  const lender = lenderWords(form.values.lender);
  const same = loans.filter((l) => (form.seriesKey !== null && l.seriesKey === form.seriesKey) || (lender !== "" && granted !== null && l.grantedCents === granted && lenderWords(l.lender ?? "") === lender));
  return same.length === 1 ? same[0]! : null;
}

export const isCredit = (kind: LoanKind | "") => kind !== "" && isRevolving(kind);

/** The form's euribor, margin and review day as core reads them, with `margin` in place of the typed one. */
const euriborOf = (form: LoanForm, margin: number | null) => ({ reference: (form.values.reference || null) as Loan["reference"], marginBp: margin, rateReviewDate: form.values.rateReviewDate || null });

/**
 * A loan on a euribor whose fixing of the last review day before its balance date is stored: its rate is that fixing
 * and the margin. A saved rate with no margin stays in its field, so an edit does not lose it.
 */
const marginOnly = (form: LoanForm, fixings: Fixings | undefined): boolean =>
  fixings !== undefined && form.values.balanceDate !== "" && (form.values.marginBp.trim() !== "" || form.values.rateBp.trim() === "") && euriborRateBp(euriborOf(form, 0), form.values.balanceDate, fixings) !== null;

/**
 * The rate the server saves a loan on a euribor at: the stored fixing of its last review day before the balance date
 * and the typed margin. Null for another rate, with no margin typed, and with no fixing that early.
 */
export function rateNow(form: LoanForm, fixings: Fixings | undefined): number | null {
  const margin = parseRate(form.values.marginBp.trim());
  return fixings === undefined || form.values.balanceDate === "" || margin === null ? null : euriborRateBp(euriborOf(form, margin), form.values.balanceDate, fixings);
}

/**
 * The fields the chosen kind has. A card or a credit line has a limit and no repayment plan (the server refuses one);
 * other loans have no limit. A loan paid back at once has no payment. A fixed rate has no review day. A loan on a
 * euribor whose fixing is stored is asked its margin alone, and its rate is counted (`rateNow`). Before a kind is
 * chosen every field shows.
 */
export function shownFields(form: LoanForm, fixings?: Fixings): LoanFieldKey[] {
  const hidden = new Set<LoanFieldKey>();
  if (form.values.reference === "fixed") hidden.add("rateReviewDate");
  if (marginOnly(form, fixings)) hidden.add("rateBp");
  if (isCredit(form.kind)) for (const key of ["grantedCents", "repayment", "intervalMonths", "paymentCents", "endDate"] as const) hidden.add(key);
  else if (form.kind !== "") hidden.add("limitCents");
  if (form.values.repayment === "bullet") hidden.add("paymentCents");
  return FIELD_KEYS.filter((key) => !hidden.has(key));
}

/** The read payment is the whole payment, and the chosen way of paying wants the amortisation alone. */
const wholeUnderEqual = (form: LoanForm) => form.paymentKind === "whole" && form.values.repayment === "equal_principal" && form.values[PAYMENT] !== "";

/** How the text gave a field, null for a form that was not read. */
export function markOf(form: LoanForm, key: LoanFieldKey): FieldMark | null {
  if (!form.source) return null;
  if (key === "paymentCents") {
    if (wholeUnderEqual(form)) return "check";
    // emptied because the text had the amortisation alone
    if (form.paymentKind !== null && form.values[PAYMENT] === "") return "missing";
  }
  return form.source.marks[key] ?? null;
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

/** The parameters of the address the Lainat report links to (`#/settings/household?linkLoan=…&linkAccount=…`): the editor of that loan opens with that account chosen. */
export const LOAN_LINK_PARAM = { loan: "linkLoan", account: "linkAccount" } as const;

/** A card or loan account a loan can be linked to, with the text the select shows for it. */
interface LinkChoice {
  id: string;
  label: string;
}

/** The cards and loan accounts that no saved loan other than `loanId` holds. */
const freeAccounts = (accounts: readonly Account[], loans: readonly Loan[], loanId: string | null): Account[] => {
  const held = new Set(loans.filter((l) => l.id !== loanId).map((l) => l.accountId));
  return accounts.filter((a) => DEBT_ACCOUNT_TYPES.includes(a.type) && !held.has(a.id));
};

/**
 * The accounts the household can say a loan is the same debt as: its own cards and loan accounts, but not one that
 * another saved loan holds, since an account has one loan. `loanId` is the loan being edited, null for a new one.
 * Two accounts of one name are told apart by their kind and card number.
 */
export function linkChoices(accounts: readonly Account[], loans: readonly Loan[], loanId: string | null): LinkChoice[] {
  const free = freeAccounts(accounts, loans, loanId);
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

/**
 * The loan the form holds, as the server takes it: every field, hidden ones as null. An empty input is null, and so is
 * a zero where the server takes none. The server checks the ranges and answers in Finnish, so only what cannot be read
 * at all is an error here.
 */
export function readForm(form: LoanForm, fixings?: Fixings): { body: LoanBody | null; errors: FormErrors } {
  const errors: FormErrors = {};
  const shown = new Set(shownFields(form, fixings));
  const text = (key: LoanFieldKey) => (shown.has(key) ? form.values[key].trim() : "");
  const cents = (key: (typeof MONEY_KEYS)[number]): number | null => {
    if (text(key) === "") return null;
    const value = parseEuros(text(key));
    if (value === null || value < 0) errors[key] = t("set.loans.loan_money_error");
    return value;
  };
  const rate = (key: (typeof RATE_KEYS)[number]): number | null => {
    if (text(key) === "") return null;
    const value = parseRate(text(key));
    if (value === null) errors[key] = t("set.loans.loan_rate_error");
    return value;
  };
  const positive = (value: number | null) => (value === 0 ? null : value);

  if (form.kind === "") errors.kind = t("set.loans.loan_pick_kind");
  if (text("balanceCents") === "") errors.balanceCents = t("set.loans.loan_need_balance");
  const balanceCents = cents("balanceCents");
  if (text("balanceDate") === "") errors.balanceDate = t("set.loans.loan_pick_date");
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
    // a split of nothing is no payment: the server refuses it, and the save must not fail for it
    ...(form.lastPayment && (form.lastPayment.principalCents > 0 || form.lastPayment.interestCents > 0 || form.lastPayment.feeCents > 0) ? { lastPayment: form.lastPayment } : {}),
  };
  return Object.keys(errors).length > 0 ? { body: null, errors } : { body: body as LoanBody, errors };
}

/**
 * The interest of one interval when the payment is smaller than it, else null. The server refuses such a loan (the
 * balance would grow), with core's `loanPeriodInterest` as here, so the form tells before saving and offers the way
 * out: an empty payment keeps the balance as it is.
 */
export function interestOverPayment(form: LoanForm, fixings?: Fixings): number | null {
  const v = form.values;
  if (isCredit(form.kind) || (v.repayment !== "annuity" && v.repayment !== "fixed_instalment") || v.intervalMonths === "") return null;
  const balance = parseEuros(v.balanceCents.trim());
  const rate = marginOnly(form, fixings) ? rateNow(form, fixings) : parseRate(v.rateBp.trim());
  const payment = parseEuros(v.paymentCents.trim());
  if (balance === null || balance < 0 || rate === null || payment === null || payment <= 0) return null;
  const interest = loanPeriodInterest(balance, rate, Number(v.intervalMonths));
  return payment < interest ? interest : null;
}
