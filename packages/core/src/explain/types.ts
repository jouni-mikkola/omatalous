/**
 * "Miksi?": how a figure tells itself. An explanation is derived every time and stores nothing (ADR 0015's way). The
 * shapes are closed: a figure and a rule are a member of a union, and a page or a route reads them without guessing.
 * Every parameter of a reason is an id, a day, cents, a count or a part: never a name, an IBAN or a bank's text; the
 * page maps an id to a display name.
 */
import type { DateRange } from "../analysis/period.ts";
import type { AccountUse, IsoDate } from "../types.ts";

/** The figures that can be explained: the front page and Raportit. */
export type FigureId =
  | "spend.month"
  | "spend.category"
  | "income.month"
  | "income.earned"
  | "yli_jai.month"
  | "usual.spend"
  | "usual.income"
  | "share.part"
  | "settlement.over";

/** What placed a row or decided its cents; each has a sentence in `catalogue.ts`. */
export type RuleId =
  | "category.hand"
  | "category.own_rule"
  | "category.builtin"
  | "transfer.pair"
  | "transfer.channel"
  | "card.bill"
  | "return.shop"
  | "return.person"
  | "return.share"
  | "refund.net"
  | "part.use"
  | "part.source"
  | "role.payer"
  | "settle.paid"
  | "settle.owed"
  | "settle.refund"
  | "settle.credit_filled"
  | "settle.unknown"
  | "settle.open"
  | "settle.closed"
  | "agree.dated"
  | "rounding.cent";

/**
 * One reason: the rule and its parameters. The parameters of each rule: `category.builtin` source; `transfer.pair`
 * other (the id of the other leg); `card.bill` card (an account id); `return.*` purchase (a row id); `refund.net`
 * purchase, months (the refund's month less the purchase's), cents; `part.use` from, to, of (a `Part`) and cents when
 * only the unknown parts of a traced row are cut by it; `part.source` owner (`u:<id>` and the like), kind, cents,
 * passed, mine.
 */
export interface Reason {
  readonly rule: RuleId;
  readonly [param: string]: string | number | boolean;
}

/** One row of a figure: its cents as counted (not the bank's), the bank's when the row is cut, and why it counts so. */
export interface Line {
  id: string;
  day: IsoDate;
  cents: number;
  /** The bank's amount in the figure's sign, when the row is cut to a part. */
  whole?: number;
  why: Reason[];
}

/** How a figure that is not a sum says what it is. */
type Method = { kind: "median"; values: { label: string; cents: number; explain?: Explanation }[]; rule: string; tie: string };

/** A sum is checked against its lines, a median against its recomputation. */
export type Check = { kind: "sum"; diffCents: number } | { kind: "recompute"; diffCents: number } | { kind: "n/a" };

export interface Explanation {
  figure: FigureId;
  kind: "sum" | "median" | "share";
  /** null: the figure says nothing (too few months). */
  cents: number | null;
  lines: Line[];
  method?: Method;
  check: Check;
}

/** Collects the reasons the decision points give while they run; with none given a decision point does nothing more. */
export interface WhyCollector {
  /** The view whose run fills it: one collector per view, so the reasons of one view never land on the rows of another. */
  readonly view: "own" | "household";
  add(id: string, reason: Reason): void;
  /** Takes back the reasons of one rule: a later step changed what the row is. */
  drop(id: string, rule: RuleId): void;
  of(id: string): readonly Reason[];
}

/** What `explain` is asked: the view, the range, and what the figure needs besides. */
export interface ExplainArgs {
  /** Own or household: `ctx` is that view's, and so is `why`. */
  view: "own" | "household";
  range: DateRange;
  /** Where the page restricts the figure to accounts, their keys: a figure of one account is a figure of its own. */
  accountIds?: readonly string[];
  /** `spend.category`: the category. */
  category?: string;
  why?: WhyCollector;
  /** `share.part`: the row, the use of its account (its users in the order of the parts) and the viewing user (null: the user with no id). */
  rowId?: string;
  use?: AccountUse;
  viewerId?: string | null;
}
