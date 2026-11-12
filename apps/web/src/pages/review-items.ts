/**
 * Tarkistettavat without React: the items GET /api/review sends, what each one asks in the page's words, and the sitting
 * (at most `SITTING` items, then "Kävit tämän erän kysymykset läpi"). The page draws what these return.
 */
import { addMonths, fold, LOAN_KIND_ANSWERS, type LoanKind, monthOf, type PayerRole } from "@banking/core";
import { KIND_LABEL } from "../components/loans/labels.ts";
import { PAYER_ROLE_LABEL, WALLET_ROLE_LABEL } from "../components/questions.ts";
import { date, dateTime, money } from "../format.ts";
import type { SyncRun } from "../types.ts";
import { t, tn } from "../text.ts";

interface Base {
  id: string;
  /** The money at stake over a year, positive: the queue's order. */
  cents: number;
  /** The item's own rows, newest first, as the server picked them: the page shows them as they are. */
  rows?: ItemRow[];
  /** How many rows the item counts; `rows` holds the newest of them. */
  rowCount?: number;
}

/** A row of an item: the payee's display name, and the bank's own text to read beside it. */
interface ItemRow {
  id: string;
  date: string;
  cents: number;
  name: string;
  text: string;
}

interface PayeeItem extends Base {
  kind: "payee_out" | "payee_in";
  merchant: string;
  count: number;
  lastDate: string;
  service?: string;
  /** The categories offered first: the guess when there is one, then the household's most used on this side. */
  picks: string[];
  /** The app's guess and why, when its evidence is strong enough; the household decides. */
  guess?: { category: string; reason: string };
}

export interface PayerItem extends Base {
  kind: "payer";
  key: string;
  merchant: string;
  count: number;
  lastDate: string;
  options: PayerRole[];
  proposal: PayerRole | null;
  wallet?: true;
}

export interface LoanItem extends Base {
  kind: "loan";
  key: string;
  payee: string;
  paymentCents: number;
  months: number;
  firstDate: string;
  lastDate: string;
  guess: LoanKind;
  placed: boolean;
}

/** An instalment plan whose end nobody has said: payments left, the last month, or "En tiedä". */
export interface PlanItem extends Base {
  kind: "plan";
  key: string;
  payee: string;
  paymentCents: number;
  lastDate: string;
}

interface SplitItem extends Base {
  kind: "split";
  accountId: string;
  accountName: string;
  question: "in" | "opening";
  key: string;
  label: string;
}

/** `reason` is why the series is asked about: its price rose (`price`), it began lately (`since`) or it has run long with no answer. Absent from an older server, which sent only the last. */
interface SubscriptionItem extends Base {
  kind: "subscription";
  reason?: "price" | "new" | "quiet";
  price?: { fromCents: number; toCents: number; date: string };
  since?: string;
  seriesId: string;
  subject: string;
  merchant: string;
  monthlyCents: number;
  lastDate: string;
}

/** Whether the household has a home loan: Lisää asuntolaina opens Asetukset > Lainat, Ei asuntolainaa is the mark `question:mortgage`. */
interface MortgageItem extends Base {
  kind: "mortgage";
}

/** An account whose rows do not add up to the bank's balances over its newest stretch: `cents` is what they differ by. It goes when the rows add up again. */
interface BalanceItem extends Base {
  kind: "balance";
  accountId: string;
  accountName: string;
  fromDay: string;
  toDay: string;
  bankCents: number;
  rowsCents: number;
}

/** A bank consent that ended (`daysLeft` null) or ends soon: the bank is connected again in Asetukset. */
interface ConsentItem extends Base {
  kind: "consent";
  connection: string;
  institution: string;
  daysLeft: number | null;
  accounts: string[];
}

/** A bill whose charge did not come: it goes when the charge comes, when the series is marked Lopetettu (mark `cancelled` on `subject`) or Tulee vielä is said for this due day (`in_use` on `comingSubject`). */
interface BillItem extends Base {
  kind: "bill";
  seriesId: string;
  subject: string;
  comingSubject: string;
  merchant: string;
  dueDate: string;
}

/** A row with no payee name: a category for the one row (PATCH /api/transactions/:id). */
interface RowItem extends Base {
  kind: "row";
  rowId: string;
  side: "out" | "in";
  date: string;
  picks: string[];
}

/** The last fetch from the bank failed. The page makes it from the run `/api/meta` tells; it goes when a fetch succeeds. */
interface FetchItem extends Base {
  kind: "fetch";
  /** When the run ended (or started, when it never ended). */
  at: string;
  /** What the run ran into, in the server's words. */
  message: string | null;
}

export type ReviewItem = PayeeItem | PayerItem | LoanItem | PlanItem | SplitItem | SubscriptionItem | MortgageItem | BalanceItem | ConsentItem | BillItem | RowItem | FetchItem;

/**
 * A failed fetch is a queue item (design, section 4): the last run that failed stays first in the queue until a later
 * run succeeds, whatever page was open when it failed. No answer here removes it; Ohita passes it for this sitting.
 * The queue the page shows: a failed fetch first, then what the server asks.
 */
export const withFetch = (items: readonly ReviewItem[], run: SyncRun | null | undefined): ReviewItem[] => run?.status === "failed" ? [{ kind: "fetch", id: `fetch:${run.id}`, cents: 0, at: run.finishedAt ?? run.startedAt, message: run.message }, ...items] : [...items];

/**
 * Whether the item needs the household: a bill that did not come, a loan or a plan with nothing saved of it, a home loan
 * the costs lack, a price that rose or a new charge, a bank connection or a fetch that failed, rows that do not add up.
 * What is left only sorts money into its category or its payer's role (a payee, a payer, one row, a shared account's
 * money, a subscription that runs as before): it waits in Tarkistettavat and Yhteenveto does not show it.
 */
export function needsUser(item: ReviewItem): boolean {
  switch (item.kind) {
    case "bill":
    case "loan":
    case "plan":
    case "mortgage":
    case "consent":
    case "fetch":
    case "balance":
      return true;
    case "subscription":
      return (item.reason === "price" && item.price !== undefined) || (item.reason === "new" && item.since !== undefined);
    case "payee_out":
    case "payee_in":
    case "payer":
    case "row":
    case "split":
      return false;
  }
}

/** The queue with the item `id` first, as the row of Yhteenveto that opened the page asks; the queue as it is when no item has that id. */
export function withFirst(items: readonly ReviewItem[], id: string | null): ReviewItem[] {
  const first = id === null ? undefined : items.find((i) => i.id === id);
  return first ? [first, ...items.filter((i) => i !== first)] : [...items];
}

export interface ReviewAnswer {
  items: ReviewItem[];
}

/** Items in one sitting (RES1: a finite inbox of 25). After them the page says it is enough for now. */
export const SITTING = 25;

/** What the sitting has gone through: the ids answered and the ids passed with Ohita. */
export interface Sitting {
  answered: readonly string[];
  skipped: readonly string[];
}

export const NEW_SITTING: Sitting = { answered: [], skipped: [] };

export type SittingView =
  | { state: "item"; item: ReviewItem; position: number; of: number }
  | { state: "enough"; left: number }
  | { state: "skipped"; left: number }
  | { state: "empty" };

/**
 * The kinds this page has a card for. An item of a kind that is not here (the server's `extension`, which no source
 * sends today, the `input` an older server asked a tip's number with, or a newer server's) is left out, since the words below have nothing to say of it.
 */
const KINDS: Record<ReviewItem["kind"], true> = { payee_out: true, payee_in: true, payer: true, loan: true, plan: true, split: true, subscription: true, mortgage: true, balance: true, consent: true, bill: true, row: true, fetch: true };
const hasCard = (item: { kind: string }): boolean => Object.hasOwn(KINDS, item.kind);

/** The items still open: the queue without what this sitting has answered. The one number its heading and the header's mark show. */
export const openItems = (items: readonly ReviewItem[], sitting: Sitting) => items.filter((i) => hasCard(i) && !sitting.answered.includes(i.id));

/**
 * Where the sitting stands. An answered item is gone from the queue as soon as the page knows it, also before the queue
 * is read again; a skipped one waits for the next sitting. The count is of the items still open, skipped ones too.
 */
export function sittingView(items: readonly ReviewItem[], sitting: Sitting): SittingView {
  const open = openItems(items, sitting);
  const seen = sitting.answered.length + sitting.skipped.length;
  if (open.length === 0) return { state: "empty" };
  if (seen >= SITTING) return { state: "enough", left: open.length };
  const ahead = open.filter((i) => !sitting.skipped.includes(i.id));
  if (ahead.length === 0) return { state: "skipped", left: open.length };
  return { state: "item", item: ahead[0]!, position: seen + 1, of: Math.min(SITTING, seen + ahead.length) };
}

/** The small line over the item: what kind of thing it is. */
export function eyebrow(item: ReviewItem): string {
  switch (item.kind) {
    case "payee_out":
      return t("set.ri.unclassified_expense");
    case "payee_in":
      return t("set.ri.unclassified_income");
    case "payer":
      return t("set.ri.money_received");
    case "loan":
      return t("set.ri.loan");
    case "plan":
      return t("set.ri.instalment_plan");
    case "split":
      return t("set.ri.joint_account_account", { account: item.accountName });
    case "subscription":
      return item.reason === "price" && item.price ? t("set.ri.price_rose") : item.reason === "new" && item.since ? t("set.ri.new_charge") : t("set.ri.subscription");
    case "mortgage":
      return t("set.ri.housing");
    case "balance":
      return t("set.ri.balance");
    case "consent":
    case "fetch":
      return t("set.ri.bank_connection");
    case "bill":
      return t("set.ri.missed_bill");
    case "row":
      return item.side === "in" ? t("set.ri.unclassified_income") : t("set.ri.unclassified_expense");
  }
}

/** Who or what the item is about, the name beside its mark. */
export function nameOf(item: ReviewItem): string {
  switch (item.kind) {
    case "payee_out":
      return item.service ?? item.merchant;
    case "payee_in":
    case "subscription":
      return item.merchant;
    case "payer":
      return item.wallet ? "MobilePay" : item.merchant;
    case "loan":
    case "plan":
      return item.payee;
    case "split":
      return item.question === "opening" ? t("set.ri.balance_before_date", { date: date(item.label) }) : item.label;
    case "mortgage":
      return t("set.ri.home_loan");
    case "balance":
      return item.accountName;
    case "consent":
      return item.institution;
    case "fetch":
      return t("set.sync.fetches");
    case "bill":
      return item.merchant;
    case "row":
      return t("set.ri.row_without_name");
  }
}

/** A person's money gets the person glyph, never initials: a payer the app would offer "Omaa rahaa", a shared account's payer. */
export function isPerson(item: ReviewItem): boolean {
  return (item.kind === "payer" && !item.wallet && item.options.includes("own_money")) || (item.kind === "split" && item.question === "in");
}

/** The question itself, the page's heading for the item. */
export function questionOf(item: ReviewItem): string {
  switch (item.kind) {
    case "payee_out":
      return item.service ? t("set.ri.what_did_these_payments_go") : t("set.ri.which_category_do_these_payments");
    case "payee_in":
      return t("set.ri.what_is_this_income");
    case "payer":
      return t("set.ri.what_are_these_payments");
    case "loan":
      return t("set.ri.which_loan_is_this");
    case "plan":
      return t("set.ri.how_many_payments_are_left");
    case "split":
      return t("set.ri.whose_money_was_this");
    case "subscription":
      // a charge that began lately has not run long enough to ask whether it is "still" used
      return item.reason === "new" && item.since ? t("set.ri.is_the_subscription_in_use") : t("set.ri.is_the_subscription_still_in");
    case "mortgage":
      return t("set.ri.do_you_have_a_home");
    case "balance":
      return t("set.ri.is_a_row_missing");
    case "consent":
      return item.daysLeft === null ? t("set.ri.the_connection_has_ended") : t("set.ri.the_connection_is_ending");
    case "bill":
      return t("set.ri.is_the_bill_still_coming");
    case "fetch":
      return t("sync.failed");
    case "row":
      return item.side === "in" ? t("set.ri.what_is_this_income") : t("set.ri.which_category_does_this_payment");
  }
}

/** The item's figure and the line under it. */
export function figureOf(item: ReviewItem): { text: string; unit?: string; line: string } {
  switch (item.kind) {
    case "payee_out":
    case "payee_in":
    case "payer":
      // the sum of the rows of the last 365 days: one payment, or a few weeks of history, would read as a year's figure with "vuodessa"
      return { text: money(item.cents), unit: t("set.ri.in_total"), line: tn(item.count, "set.ri.payments_year_one", "set.ri.payments_year_many", { last: date(item.lastDate) }) };
    case "loan":
      return { text: money(item.paymentCents), unit: t("set.ri.a_month"), line: tn(item.rowCount ?? item.months, "set.ri.payments_since_one", "set.ri.payments_since_many", { first: date(item.firstDate), last: date(item.lastDate) }) };
    case "plan":
      return { text: money(item.paymentCents), unit: t("set.ri.a_month"), line: t("set.ri.latest_payment_date_the_amount", { date: date(item.lastDate) }) };
    case "split":
      return { text: money(item.cents), unit: t("set.ri.in_total"), line: item.question === "opening" ? t("set.ri.the_account_already_had_money") : t("set.ri.money_has_come_into_the") };
    case "subscription": {
      // a rise says the old and the new charge (its `cents` may be what the rise adds, so no year is told), a new charge its first day
      const line =
        item.reason === "price" && item.price
          ? t("set.ri.before_amount_from_date_now", { before: money(item.price.fromCents), date: date(item.price.date), now: money(item.price.toCents) })
          : item.reason === "new" && item.since
            ? t("set.ri.amount_a_year_first_date", { amount: money(item.cents), date: date(item.since) })
            : t("set.ri.amount_a_year_last_date", { amount: money(item.cents), date: date(item.lastDate) });
      return { text: money(item.monthlyCents), unit: t("set.ri.a_month"), line };
    }
    case "mortgage":
      return { text: "", line: t("set.ri.housing_costs_show_no_loan") };
    case "balance":
      return { text: money(item.cents), unit: t("set.ri.difference"), line: t("set.ri.balance_changed_rows_add_up", { from: date(item.fromDay), to: date(item.toDay), bank: money(item.bankCents), rows: money(item.rowsCents) }) };
    case "consent":
      return {
        text: money(item.cents),
        // also the rows of the last 365 days, however long the bank has been connected
        unit: t("set.ri.in_total"),
        line: item.daysLeft === null ? t("set.ri.consent_ended_accounts", { accounts: item.accounts.join(", ") }) : tn(item.daysLeft, "set.ri.consent_ends_one", "set.ri.consent_ends_many", { accounts: item.accounts.join(", ") }),
      };
    case "bill":
      return { text: money(item.cents), line: t("set.ri.the_bill_was_expected_on", { date: date(item.dueDate) }) };
    case "fetch":
      // no sum: what failed, in the server's words when it has them, and when
      return { text: "", line: [item.message, dateTime(item.at)].filter(Boolean).join(" · ") };
    case "row":
      return { text: money(item.cents), line: date(item.date) };
  }
}

/** A choice of a button: its label, and whether it is the app's guess (drawn first, marked Ehdotus). */
export interface Choice<T> {
  value: T;
  label: string;
  guess: boolean;
}

const guessFirst = <T>(choices: Choice<T>[]): Choice<T>[] => [...choices.filter((c) => c.guess), ...choices.filter((c) => !c.guess)];

/** A payer's roles, the proposal first. */
export function payerChoices(item: PayerItem): Choice<PayerRole>[] {
  const label = (role: PayerRole) => (item.wallet ? (WALLET_ROLE_LABEL[role] ?? PAYER_ROLE_LABEL[role]) : PAYER_ROLE_LABEL[role]);
  return guessFirst(item.options.map((role) => ({ value: role, label: label(role), guess: role === item.proposal })));
}

/**
 * The kinds of a loan, one question for every loan: the kind its rows suggest first and named (for a loan saved with
 * its form also one the plain answers lack, such as Osamaksu), then the rest. "Muu laina" is no guess worth marking.
 */
export function loanKindChoices(item: LoanItem): Choice<LoanKind>[] {
  // a kind the plain answers lack is offered only where it is saved with the loan's form, not stored as an answer
  const kinds: LoanKind[] = !item.placed || (LOAN_KIND_ANSWERS as readonly LoanKind[]).includes(item.guess) ? [...LOAN_KIND_ANSWERS] : [item.guess, ...LOAN_KIND_ANSWERS];
  return guessFirst(kinds.map((kind) => ({ value: kind, label: KIND_LABEL[kind], guess: kind === item.guess && kind !== "other" })));
}

/** The line at the end of a sitting, and of an empty queue. */
export const leftText = (left: number): string => (left === 1 ? t("set.ri.one_left") : t("set.ri.n_left", { left }));

/** The most payments a plan may have left, as the answer is checked. */
export const MAX_PLAN_PAYMENTS = 120;

/** The month of a plan's last payment when `left` payments follow the latest one; null for a count that is no whole number from 1 to 120. */
export function planEnd(item: Pick<PlanItem, "lastDate">, left: string): string | null {
  const count = Number(left.trim());
  return left.trim() !== "" && Number.isInteger(count) && count >= 1 && count <= MAX_PLAN_PAYMENTS ? addMonths(monthOf(item.lastDate), count) : null;
}

/** The categories a payee may take, as the old picker offered them: money out any but Muut menot, money in only the income ones. */
export function offeredCategories<C extends { id: string; kind: string }>(categories: readonly C[], incomeOnly: boolean): C[] {
  return categories.filter((c) => (incomeOnly ? c.kind === "income" : c.id !== "other"));
}

/** The categories whose name holds the search, in their report groups, in the order the list gives them. */
export function groupCategories<C extends { label: string; group: string }>(categories: readonly C[], search: string): [string, C[]][] {
  const wanted = fold(search.trim());
  const groups = new Map<string, C[]>();
  for (const c of categories) if (!wanted || fold(c.label).includes(wanted) || fold(c.group).includes(wanted)) groups.set(c.group, [...(groups.get(c.group) ?? []), c]);
  return [...groups];
}
