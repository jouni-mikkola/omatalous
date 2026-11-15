// Decision: which debt to pay down first, and whether the payments hold when the reference rate moves
import { belowWhole, type LoanFigureId, cardLimitCents, type LoanRow, type LoansReport, type MaybeTwice, type RateScenario } from "@banking/core";
import { Fragment, type ReactNode } from "react";
import { LOAN_LINK_PARAM } from "../../../components/loans/form.ts";
import { intervalLabel, KIND_LABEL, referenceName } from "../../../components/loans/labels.ts";
import { Figure } from "../../../components/Figure.tsx";
import { Why } from "../../../components/Why.tsx";
import { DebtPath, DebtPathTable } from "../../../charts/forms/DebtPath.tsx";
import { QuestionChart, ReportPanel } from "../../../charts/forms/parts.tsx";
import { ACCOUNT_TYPE_LABEL, date, money, monthLongIn, percent, plainNumber } from "../../../format.ts";
import { accountsLessDebt, sameDebtTwice } from "../parts.tsx";
import { typedByText } from "../../../part.ts";
import { LOANS_REPORT_ANCHOR, SETTINGS_ANCHOR, settingsCardHash } from "../../../routes.ts";
import type { Scope } from "../../../types.ts";
import type { ReportSection, SectionProps } from "../types.ts";
import "../../../styles/loans.css";
import { Notice } from "../../../components/ui/Notice.tsx";
import { t } from "../../../text.ts";
/** A figure the loan has no value for: nothing is due, nothing was drawn, or the household has not told it. */
const DASH = "–";

interface LoanFigureProps {
  label: string;
  /** Null when the figure is not known: a dash. */
  value: string | null;
  sub?: string | null;
  /** Labelled values the figure is made of, each a row of its own under it. */
  parts?: readonly (readonly [label: string, value: string])[];
  /** The figure whose calculation the value opens; a word or a dash opens nothing. */
  door?: LoanFigureId;
}

/** Where the report's figures open their calculation: the report's day, in the view the page shows. */
interface At {
  scope: Scope;
  day: string;
}

/** A figure of the report as the door to its calculation: `loan` for a figure of one loan, `title` as the panel names it. */
function door(at: At, figure: LoanFigureId, title: string, text: string, shown: ReactNode = text, loan?: string): ReactNode {
  return (
    <Why figure={figure} loan={loan} title={title} range={{ from: at.day, to: at.day }} scope={at.scope} text={text}>
      {shown}
    </Why>
  );
}

function LoanFigure({ label, value, sub, parts, door: opens, loan, at }: LoanFigureProps & { loan: LoanRow; at: At }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd className={value === null ? "unknown" : undefined}>
        {value === null ? DASH : opens ? door(at, opens, `${loan.name}, ${label.toLowerCase()}`, value, value, loan.id) : value}
        {sub && <small>{sub}</small>}
        {parts && parts.length > 0 && (
          <dl className="loan-parts">
            {parts.map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
        )}
      </dd>
    </div>
  );
}

function payment(l: LoanRow): Pick<LoanFigureProps, "value" | "sub" | "parts"> {
  const p = l.payment;
  if (p.cents === null) {
    // the amortisation of an equal principal loan is known also when the interest on top of it is not
    if (p.unknown !== null) return { value: null, parts: p.amortisationCents !== null ? [[t("rpt.ln_repay"), money(p.amortisationCents)]] : [] };
    // nothing is due: a bullet pays at the end, any other loan owes nothing
    return l.repayment === "bullet" && (l.balance.cents ?? 0) > 0 ? { value: t("rpt.ln_bullet"), sub: t("rpt.ln_bullet_sub") } : { value: DASH };
  }
  const monthly = p.intervalMonths === 1;
  return {
    value: monthly ? t("rpt.ln_per_month", { amount: money(p.cents) }) : money(p.cents),
    sub: p.intervalMonths === null || monthly ? null : intervalLabel(p.intervalMonths).toLowerCase(),
    parts: p.interestCents !== null && p.amortisationCents !== null ? [[t("rpt.ln_interest"), money(p.interestCents)], [t("rpt.ln_repay"), money(p.amortisationCents)]] : [],
  };
}

/** The date of the last payment. A debt that owed nothing to begin with has none. */
function lastPayment(l: LoanRow): string | null {
  if (l.payoff.date) return date(l.payoff.date);
  if (l.payoff.never) return t("rpt.ln_no_paydown");
  return l.payoff.unknown ? null : DASH;
}

/**
 * One move of the reference rate, as far as it went: the payment and the interest of 12 months after it. Only a figure
 * the move has is named, so a loan without a plan tells its interest alone, and a move with no figure is no line (null).
 */
function scenario(s: RateScenario): string | null {
  const moved = Math.abs(s.movedBp ?? s.shiftBp);
  const points = moved === 100 ? t("rpt.ln_pp_one") : t("rpt.ln_pp_n", { n: plainNumber(moved / 100) });
  const figures = [
    ...(s.paymentCents !== null ? [t("rpt.ln_fig_payment", { amount: money(s.paymentCents) })] : []),
    ...(s.interestCents !== null ? [t("rpt.ln_fig_interest", { amount: money(s.interestCents, false) })] : []),
  ];
  return figures.length ? t(s.shiftBp < 0 ? "rpt.ln_rate_down" : "rpt.ln_rate_up", { points, figures: figures.join(", ") }) : null;
}

/** A word under a loan's name unless it only repeats the name: "Asuntolaina" under the name "Asuntolaina". */
const unlessName = (word: string, name: string) => (word.trim().toLowerCase() === name.trim().toLowerCase() ? null : word);

/** Where a loan's missing terms are told: the card Lainat of Asetukset. */
const SETTINGS_LOANS = settingsCardHash(SETTINGS_ANCHOR.loans);

/** `limitCents`: the limit of a connected card, when it has one to tell. */
function Loan({ l, limitCents, at }: { l: LoanRow; limitCents: number | null; at: At }) {
  // a connected card is a card: what is used and the limit, none of a loan's terms
  const card = l.accountType === "credit_card";
  const kind = l.accountType
    ? card
      ? null
      : [t("rpt.ln_connected"), unlessName(ACCOUNT_TYPE_LABEL[l.accountType] ?? l.accountType, l.name)].filter(Boolean).join(" · ")
    : [unlessName(KIND_LABEL[l.kind], l.name), l.lender].filter(Boolean).join(" · ");
  const about = [kind, typedByText(l.typedBy)].filter(Boolean).join(" · ");
  const moves = l.scenarios.map(scenario).filter((line): line is string => line !== null);
  const figures: LoanFigureProps[] = card
    ? [{ label: t("rpt.ln_used"), value: l.balance.cents !== null ? money(l.balance.cents) : null, door: "loan.balance" as const }, ...(limitCents !== null ? [{ label: t("rpt.ln_limit"), value: money(limitCents) }] : [])]
    : [
        // a balance no plan moved forward is the one that was told, with its day
        { label: t("rpt.ln_debt"), value: l.balance.cents !== null ? money(l.balance.cents) : null, sub: l.balance.cents !== null && l.balance.unknown ? t("rpt.ln_left_on", { date: date(l.balanceDate) }) : null, door: "loan.balance" },
        { label: t("rpt.ln_rate"), value: l.rateBp !== null ? percent(l.rateBp / 10_000, 2) : null, sub: l.reference ? referenceName(l.reference) : null },
        // only a payment with a figure opens: "Kertalyhennys" and a dash are words
        { label: t("rpt.ln_payment"), ...payment(l), ...(l.payment.cents !== null ? { door: "loan.payment" as const } : {}) },
        { label: t("rpt.ln_interest12"), value: l.interest.cents !== null ? money(l.interest.cents, false) : null, door: "loan.interest" },
        { label: t("rpt.ln_last_due"), value: lastPayment(l) },
      ];
  if (belowWhole(l.part)) figures.push({ label: t("rpt.ln_your_share"), value: percent((l.part.to - l.part.from) / l.part.of) });
  // a loan of the viewer's own with a dash in it is theirs to complete: another member's loan is its typist's, and a connected account has no saved loan
  const mend = l.accountType === null && !l.typedBy && figures.some((f) => f.value === null);
  return (
    <li>
      <div className="loan-head">
        <strong>{l.name}</strong>
        {about && <span>{about}</span>}
      </div>
      <dl className="loan-figures">
        {figures.map((f) => (
          <LoanFigure key={f.label} {...f} loan={l} at={at} />
        ))}
      </dl>
      {moves.length > 0 && <p className="loan-scenario">{moves.join(" ")}</p>}
      {mend && (
        <a className="loan-mend" href={SETTINGS_LOANS}>
          {t("rpt.ln_complete")}
        </a>
      )}
    </li>
  );
}

/** "A", "A ja B", "A, B ja C" */
const listed = (names: readonly string[], last: string) => (names.length === 1 ? names[0]! : `${names.slice(0, -1).join(", ")} ${last} ${names.at(-1)}`);
const and = () => t("rpt.ln_and");
const or = () => t("rpt.ln_or");

/** The two sides of a debt that may be there twice: any one of the saved loans, and every account beside them. */
const sides = (twin: MaybeTwice) =>
  t("rpt.ln_sides", {
    loans: listed(twin.loans.map((l) => l.name), or()),
    accounts: t(twin.accounts.length === 1 ? "rpt.ln_acct_one" : "rpt.ln_acct_many", { names: listed(twin.accounts.map((a) => a.name), and()) }),
  });

/** A link that ends a sentence: it opens an editor in Asetukset > Lainat. */
interface Offer {
  label: string;
  href: string;
}

/**
 * What the household can do about a debt that may be twice: link a saved loan to one of its own accounts, one link for
 * each loan beside each account. An account of another member is not offered, since only its owner's loan links to it,
 * and neither is a loan another member typed in (`typists`, by loan id): its editor opens for its typist alone.
 */
function offers(twin: MaybeTwice, own: ReadonlySet<string>, typists: ReadonlyMap<string, string>): Offer[] {
  return twin.loans
    .filter((l) => !typists.has(l.id))
    .flatMap((l) =>
      twin.accounts
        .filter((a) => own.has(a.id))
        .map((a) => ({ label: t("rpt.ln_link", { loan: l.name, account: a.name }), href: settingsCardHash(SETTINGS_ANCHOR.loans, new URLSearchParams({ [LOAN_LINK_PARAM.loan]: l.id, [LOAN_LINK_PARAM.account]: a.id })) })),
    );
}

/** Who typed in the saved loans of a set when none of them is the viewer's own: only they can remove one. Nobody when the viewer has a loan in it. */
const removers = (twin: MaybeTwice, typists: ReadonlyMap<string, string>): string[] => (twin.loans.every((l) => typists.has(l.id)) ? [...new Set(twin.loans.map((l) => typists.get(l.id)!))] : []);

/**
 * A debt that may be in the total twice, and what takes the second one out: the link of the loan to the account, which
 * counts the pair once. With no account of the household's own to link to, removing the saved loan does it: the viewer
 * removes their own, and `others` names who can when every saved loan of the set is another member's.
 */
function twice(twin: MaybeTwice, linkable: boolean, others: readonly string[]): string {
  const remove = others.length ? t("rpt.ln_remove_others", { names: listed(others, or()) }) : t("rpt.ln_remove_own");
  const fix = linkable ? t("rpt.ln_fix_link") : t("rpt.ln_fix_remove", { remove });
  return t("rpt.ln_twice", { same: sameDebtTwice(), sides: sides(twin), fix });
}

/**
 * A debt that may be twice in the accounts less the debts alone: an account below zero beside a saved credit line. The
 * debt total holds it once, and removing the saved loan would take it out of that total, so the sentence tells what
 * the figure would be and advises no step. Said where the figure is: its tile here and its line in Saldot.
 */
export function overdraftTwice(): string {
  return t("rpt.ln_overdraft", { label: accountsLessDebt().label });
}

/** A set of saved loans is one entry of its list, so its ids are a key no other sentence has. */
const idsOf = (twin: MaybeTwice) => twin.loans.map((l) => l.id).join(" ");

interface Note {
  key?: string;
  text: string;
  warn?: boolean;
  /** Links that end the sentence. */
  offers?: Offer[];
}

/** What the debt total leaves out, and a debt that may be in a figure twice. `less`: the accounts less the debts are shown. `own`: the ids of the viewer's own accounts. */
function notes(r: LoansReport, less: boolean, own: ReadonlySet<string>): Note[] {
  const late = r.total.unknown.filter((u) => !u.counted).length;
  const typists = new Map(r.loans.flatMap((l): [string, string][] => (l.typedBy ? [[l.id, l.typedBy]] : [])));
  return [
    ...(late ? [{ text: late === 1 ? t("rpt.ln_late_one") : t("rpt.ln_late_n", { n: late }) }] : []),
    ...r.maybeTwice.map((twin) => {
      const links = offers(twin, own, typists);
      return { key: `twice ${idsOf(twin)}`, text: twice(twin, links.length > 0, removers(twin, typists)), warn: true, offers: links };
    }),
    ...(less && r.overdraftTwice.length > 0 ? [{ key: "overdraft", text: overdraftTwice(), warn: true }] : []),
  ];
}

/** "maaliskuussa 2041": the month a date falls in, in the inessive (every month's name ends in -kuu). */
const inMonth = (day: string) => monthLongIn(day.slice(0, 7));

/** The answer under the path: when the last loan is paid, what is still to pay, what a rise of the reference rate adds, and the debts left out. */
function pathAnswer(path: LoansReport["path"]): string {
  const up = path.moves.find((m) => m.shiftBp > 0);
  const left = path.left.map((l) => l.name);
  return [
    path.payoff && t("rpt.ln_path_last", { month: inMonth(path.payoff) }),
    t("rpt.ln_path_now", { debt: money(path.balanceCents[0]!, false), interest: money(path.interestCents[0]!, false) }),
    up && t("rpt.ln_path_up", { amount: money(up.extraCents, false) }),
    left.length > 0 && t(left.length === 1 ? "rpt.ln_path_left_one" : "rpt.ln_path_left_many", { names: listed(left, and()) }),
  ]
    .filter(Boolean)
    .join(" ");
}

function Loans({ ctx }: SectionProps) {
  const r = ctx.data.loans;
  const b = ctx.data.balances;
  // the accounts less the debts are told for today only, as the debts are: a range that ends before today has no point for them
  const last = b.months.length - 1;
  const less = last >= 0 && b.months[last] === ctx.running ? b.accountsLessDebt[last] : undefined;
  const p = r.payments;
  // only bullets owe: there is no payment to add up, and a zero would hide the interest they pay
  const monthly = p.counted > 0 ? money(p.monthlyCents, false) : p.unknown > 0 ? DASH : p.bullets > 0 ? t("rpt.ln_no_payments") : money(0, false);
  const at: At = { scope: ctx.scope, day: r.day };
  const items: [label: string, value: string, sub?: string, figure?: LoanFigureId][] = [
    [t("rpt.ln_total"), money(r.total.cents, false), undefined, "loans.total"],
    [t("rpt.ln_interest12"), r.interestKnown ? money(r.interest.cents, false) : DASH, undefined, r.interestKnown ? "loans.interest" : undefined],
    [t("rpt.ln_payments_month"), monthly, undefined, p.counted > 0 ? "loans.payments" : undefined],
    ...(less === undefined ? [] : [[accountsLessDebt().label, less === null ? DASH : money(less, false), accountsLessDebt().sub] as [string, string, string]]),
  ];
  const lines = notes(r, less !== undefined, new Set(ctx.meta.accounts.map((a) => a.id)));
  // the limit of a connected card is the account's own: a card at a part shows the viewer's part of what is used, and no limit beside it
  const limitOf = (l: LoanRow) => (l.accountType === "credit_card" && !belowWhole(l.part) ? cardLimitCents(ctx.meta.accounts.find((a) => `account:${a.id}` === l.id)?.creditLimitCents) : null);
  return (
    <ReportPanel id={section.id} title={section.title}>
      <div className="kv">
        {items.map(([label, value, sub, figure]) => (
          <div key={label}>
            <div className="k">{label}</div>
            <div className="v">{figure ? door(at, figure, label, value, <Figure text={value} size="m" />) : <Figure text={value} size="m" />}</div>
            {sub && <div className="loans-tile-sub">{sub}</div>}
          </div>
        ))}
      </div>
      {lines.length > 0 && (
        <ul className="loans-notes">
          {lines.map((n) => {
            const body = (
              <>
                {n.text}
                {n.offers?.map((o) => (
                  <Fragment key={o.href}>
                    {" "}
                    <a href={o.href}>{o.label}</a>
                  </Fragment>
                ))}
              </>
            );
            return n.warn ? (
              <Notice key={n.key ?? n.text} as="li" tone="warning">
                {body}
              </Notice>
            ) : (
              <li key={n.key ?? n.text}>{body}</li>
            );
          })}
        </ul>
      )}
      {r.path.tops[0]! > 0 && (
        <QuestionChart id="lainat-polku" question={t("rpt.ln_q_path")} answer={pathAnswer(r.path)} table={<DebtPathTable path={r.path} />}>
          <DebtPath path={r.path} />
        </QuestionChart>
      )}
      {r.path.tops[0]! > 0 && <hr className="qc-rule" />}
      <ul className="loan-list">
        {r.loans.map((l) => (
          <Loan key={l.id} l={l} limitCents={limitOf(l)} at={at} />
        ))}
      </ul>
    </ReportPanel>
  );
}

export const section: ReportSection = {
  id: LOANS_REPORT_ANCHOR,
  get title() {
    return t("rpt.sec_loans");
  },
  // right under Saldot: what is owed after what is held
  order: 115,
  page: "reports",
  reports: ["loans", "balances"],
  // balances is read for the accounts less the debts of the running month only; a period that ends before it hides that tile
  ofToday: ["balances"],
  // a household that saved no loan sees what it saw: its connected debts are in Saldot
  visible: (ctx) => ctx.data.loans.saved > 0,
  Component: Loans,
};
