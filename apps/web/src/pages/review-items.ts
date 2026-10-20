/**
 * Tarkistettavat without React: the items GET /api/review sends, what each one asks in the page's words, and the sitting
 * (at most `SITTING` items, then "Riittää tältä kertaa"). The page draws what these return.
 */
import { addMonths, fold, inputDefOf, type InputKey, LOAN_KIND_ANSWERS, type LoanKind, monthOf, type PayerRole, type StoredInput } from "@banking/core";
import { KIND_LABEL } from "../components/loans/labels.ts";
import { valueText } from "../components/optimise/Inputs.tsx";
import { subjectName } from "../components/optimise/shared.tsx";
import { PAYER_ROLE_LABEL, WALLET_ROLE_LABEL } from "../components/questions.ts";
import { approxText } from "../components/Why.tsx";
import { date, money, plural } from "../format.ts";

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
export interface ItemRow {
  id: string;
  date: string;
  cents: number;
  name: string;
  text: string;
}

export interface PayeeItem extends Base {
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

export interface SplitItem extends Base {
  kind: "split";
  accountId: string;
  accountName: string;
  question: "in" | "opening";
  key: string;
  label: string;
}

export interface SubscriptionItem extends Base {
  kind: "subscription";
  seriesId: string;
  subject: string;
  merchant: string;
  monthlyCents: number;
  lastDate: string;
}

/** A number Säästövinkit waits for: saved with PUT /api/optimise/inputs/:key, as the page's own form saved it. */
export interface InputItem extends Base {
  kind: "input";
  key: string;
  def: InputKey;
  subject: string | null;
  old: StoredInput | null;
}

/** What Säästövinkit asks for each input, as a question. */
export const INPUT_QUESTION: Record<InputKey, string> = {
  loan_rate: "Mikä on asuntolainan marginaali ja viitekorko?",
  electricity_kwh: "Paljonko sähköä kuluu vuodessa?",
  electricity_contract_end: "Milloin sähkösopimus päättyy?",
  housing_type: "Millaisessa asunnossa asut?",
  moved_on: "Milloin muutit nykyiseen asuntoon?",
  insurance_quote: "Paljonko vakuutus maksaisi uuden tarjouksen mukaan?",
  parking_permit_price: "Mitä asukaspysäköintitunnus maksaa vuodessa?",
  car_km: "Paljonko ajat vuodessa?",
};

/** Whether the household has a home loan: Lisää asuntolaina opens Asetukset > Lainat, Ei asuntolainaa is the mark `question:mortgage`. */
export interface MortgageItem extends Base {
  kind: "mortgage";
}

/** An extension's item: `type` is the extension's own name for the kind of question, and its choices name their own answer routes. */
export interface ExtensionItem extends Base {
  kind: "extension";
  type: string;
  title: string;
  question: string;
  detail?: string;
  date?: string;
  guess?: string;
  choices: { id: string; label: string; answer: { method: "PUT" | "POST"; path: string; body: unknown } }[];
}

export type ReviewItem = PayeeItem | PayerItem | LoanItem | PlanItem | SplitItem | SubscriptionItem | InputItem | MortgageItem | ExtensionItem;

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
  | { state: "item"; item: ReviewItem; position: number; of: number; open: number }
  | { state: "enough"; left: number }
  | { state: "skipped"; left: number }
  | { state: "empty" };

/**
 * Where the sitting stands. An answered item is gone from the queue as soon as the page knows it, also before the queue
 * is read again; a skipped one waits for the next sitting. The count is of the items still open, skipped ones too.
 */
export function sittingView(items: readonly ReviewItem[], sitting: Sitting): SittingView {
  const open = items.filter((i) => !sitting.answered.includes(i.id));
  const seen = sitting.answered.length + sitting.skipped.length;
  if (open.length === 0) return { state: "empty" };
  if (seen >= SITTING) return { state: "enough", left: open.length };
  const ahead = open.filter((i) => !sitting.skipped.includes(i.id));
  if (ahead.length === 0) return { state: "skipped", left: open.length };
  return { state: "item", item: ahead[0]!, position: seen + 1, of: Math.min(SITTING, seen + ahead.length), open: open.length };
}

/** The small line over the item: what kind of thing it is. */
export function eyebrow(item: ReviewItem): string {
  switch (item.kind) {
    case "payee_out":
      return "Luokittelematon meno";
    case "payee_in":
      return "Luokittelematon tulo";
    case "payer":
      return "Saapunut raha";
    case "loan":
      return "Laina";
    case "plan":
      return "Osamaksu";
    case "split":
      return `Yhteinen tili: ${item.accountName}`;
    case "subscription":
      return "Tilaus";
    case "input":
      return "Säästövinkit";
    case "mortgage":
      return "Asuminen";
    case "extension":
      return item.title;
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
      return item.question === "opening" ? `Saldo ennen ${date(item.label)}` : item.label;
    case "input": {
      const label = inputDefOf(item.key)?.def.label ?? item.def;
      return item.subject ? `${label}: ${subjectName(item.subject)}` : label;
    }
    case "mortgage":
      return "Asuntolaina";
    case "extension":
      return item.title;
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
      return item.service ? "Mihin nämä maksut menivät?" : "Mihin kategoriaan nämä maksut kuuluvat?";
    case "payee_in":
      return "Mitä tämä tulo on?";
    case "payer":
      return "Mitä nämä maksut ovat?";
    case "loan":
      return "Mikä laina tämä on?";
    case "plan":
      return "Montako maksua on vielä jäljellä?";
    case "split":
      return "Kenen rahaa tämä oli?";
    case "subscription":
      return "Onko tilaus vielä käytössä?";
    case "input":
      return INPUT_QUESTION[item.def];
    case "mortgage":
      return "Onko teillä asuntolaina?";
    case "extension":
      return item.question;
  }
}

/** The item's figure and the line under it. */
export function figureOf(item: ReviewItem): { text: string; unit?: string; line: string } {
  switch (item.kind) {
    case "payee_out":
    case "payee_in":
    case "payer":
      return { text: money(item.cents), unit: "vuodessa", line: `${plural(item.count, "maksu", "maksua")} viimeisen vuoden aikana, viimeksi ${date(item.lastDate)}` };
    case "loan":
      return { text: money(item.paymentCents), unit: "kuussa", line: `${plural(item.rowCount ?? item.months, "maksu", "maksua")} ${date(item.firstDate)} alkaen, viimeksi ${date(item.lastDate)}` };
    case "plan":
      return { text: money(item.paymentCents), unit: "kuussa", line: `Viimeisin maksu ${date(item.lastDate)}. Määrä lasketaan siitä eteenpäin.` };
    case "split":
      return { text: money(item.cents), unit: "yhteensä", line: item.question === "opening" ? "Tilillä oli rahaa jo ennen ensimmäistä tapahtumaa. Kukaan ei ole vielä kertonut, kenen se oli." : "Tämä maksaja on tuonut tilille rahaa. Kukaan ei ole vielä kertonut, kenen se oli." };
    case "subscription":
      return { text: money(item.monthlyCents), unit: "kuussa", line: `${money(item.cents)} vuodessa, viimeksi ${date(item.lastDate)}` };
    case "input": {
      const def = inputDefOf(item.key)?.def;
      const old = item.old && def ? `Edellinen tieto ${valueText(def, item.old.value)}, annettu ${date(item.old.asOf)}, on liian vanha. ` : "";
      // the money is a tip's estimate the value makes exact; a check that waits for the value has none to show
      return item.cents > 0
        ? { text: approxText(money(item.cents, false), true), unit: "vuodessa", line: `${old}Säästövinkin arvio tarkentuu, kun kerrot tämän.` }
        : { text: "", line: `${old}Säästövinkit tarvitsee tämän, jotta tarkistus voidaan tehdä.` };
    }
    case "mortgage":
      return { text: "", line: "Asumiskuluissa ei näy lainaa. Kun lisäät asuntolainan, sen maksuerät tulevat Asumisen summaan." };
    case "extension":
      return { text: money(item.cents), unit: "yhteensä", line: [item.detail, item.date && date(item.date)].filter(Boolean).join(", ") };
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

/** An extension's choices, its guess first. */
export function extensionChoices(item: ExtensionItem): Choice<ExtensionItem["choices"][number]>[] {
  return guessFirst(item.choices.map((c) => ({ value: c, label: c.label, guess: c.id === item.guess })));
}

/** The line at the end of a sitting, and of an empty queue. */
export const leftText = (left: number): string => (left === 1 ? "Jäljellä on 1 kohde. Se odottaa seuraavaa kertaa." : `Jäljellä on ${left} kohdetta. Ne odottavat seuraavaa kertaa.`);

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
