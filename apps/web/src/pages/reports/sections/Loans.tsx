// Decision: which debt to pay down first, and whether the payments hold when the reference rate moves
import { ACCOUNTS_LESS_DEBT, FIGURE_UNKNOWN, LOAN_REFERENCE_LABEL, type LoanRow, type LoansReport, loansWithout, type MaybeTwice, type RateScenario, SAME_DEBT_TWICE } from "@banking/core";
import { Fragment } from "react";
import { LOAN_LINK_PARAM } from "../../../components/loans/form.ts";
import { intervalLabel, KIND_LABEL } from "../../../components/loans/labels.ts";
import { Section } from "../../../components/Section.tsx";
import { ACCOUNT_TYPE_LABEL, date, money, percent } from "../../../format.ts";
import { hashOf } from "../../../routes.ts";
import type { ReportSection, SectionProps } from "../types.ts";
import "../../../styles/loans.css";

/** A figure the loan does not have: nothing is due, or nothing was drawn. */
const NONE = "–";

function Figure({ label, value, sub }: { label: string; value: string | null; sub?: string | null }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd className={value === null ? "unknown" : undefined}>
        {value ?? FIGURE_UNKNOWN}
        {sub && <small>{sub}</small>}
      </dd>
    </div>
  );
}

function payment(l: LoanRow): { value: string | null; sub: string | null } {
  const p = l.payment;
  if (p.cents === null) {
    // the amortisation of an equal principal loan is known also when the interest on top of it is not
    if (p.unknown !== null) return { value: null, sub: p.amortisationCents !== null ? `lyhennystä ${money(p.amortisationCents)}` : null };
    // nothing is due: a bullet pays at the end, any other loan owes nothing
    return l.repayment === "bullet" && (l.balance.cents ?? 0) > 0 ? { value: "Kertalyhennys", sub: "maksetaan kerralla lopussa" } : { value: NONE, sub: null };
  }
  const monthly = p.intervalMonths === 1;
  const parts = [
    p.intervalMonths === null || monthly ? null : intervalLabel(p.intervalMonths).toLowerCase(),
    p.interestCents !== null && p.amortisationCents !== null ? `korkoa ${money(p.interestCents)}, lyhennystä ${money(p.amortisationCents)}` : null,
  ].filter((x): x is string => x !== null);
  return { value: monthly ? `${money(p.cents)}/kk` : money(p.cents), sub: parts.join(", ") || null };
}

/** The date of the last payment. A debt that owed nothing to begin with has none. */
function lastPayment(l: LoanRow): string | null {
  if (l.payoff.date) return date(l.payoff.date);
  if (l.payoff.never) return "Ei lyhene tällä erällä";
  return l.payoff.unknown ? null : NONE;
}

/**
 * One move of the reference rate, as far as it went: the payment and the interest of 12 months after it. Only a figure
 * the move has is named, so a loan without a plan tells its interest alone, and a move with no figure is no line (null).
 */
function scenario(s: RateScenario): string | null {
  const moved = Math.abs(s.movedBp ?? s.shiftBp);
  const points = moved === 100 ? "prosenttiyksikön" : `${(moved / 100).toLocaleString("fi-FI")} prosenttiyksikköä`;
  const figures = [
    ...(s.paymentCents !== null ? [`maksuerä ${money(s.paymentCents)}`] : []),
    ...(s.interestCents !== null ? [`korot 12 kuukaudessa ${money(s.interestCents, false)}`] : []),
  ];
  return figures.length ? `Jos viitekorko ${s.shiftBp < 0 ? "laskee" : "nousee"} ${points}: ${figures.join(", ")}.` : null;
}

function Loan({ l }: { l: LoanRow }) {
  const about = l.accountType ? `Yhdistetty tili · ${ACCOUNT_TYPE_LABEL[l.accountType] ?? l.accountType}` : [KIND_LABEL[l.kind], l.lender].filter(Boolean).join(" · ");
  const pay = payment(l);
  const moves = l.scenarios.map(scenario).filter((line): line is string => line !== null);
  return (
    <li>
      <div className="loan-head">
        <strong>{l.name}</strong>
        <span>{about}</span>
      </div>
      <dl className="loan-figures">
        {/* a balance no plan moved forward is the one that was told, with its day */}
        <Figure label="Velkaa" value={l.balance.cents !== null ? money(l.balance.cents) : null} sub={l.balance.cents !== null && l.balance.unknown ? `jäljellä ${date(l.balanceDate)}` : null} />
        <Figure label="Korko" value={l.rateBp !== null ? percent(l.rateBp / 10_000, 2) : null} sub={l.reference ? LOAN_REFERENCE_LABEL[l.reference] : null} />
        <Figure label="Maksuerä" value={pay.value} sub={pay.sub} />
        <Figure label="Korot 12 kuukaudessa" value={l.interest.cents !== null ? money(l.interest.cents, false) : null} />
        <Figure label="Viimeinen eräpäivä" value={lastPayment(l)} />
      </dl>
      {moves.length > 0 && <p className="loan-scenario">{moves.join(" ")}</p>}
    </li>
  );
}

/** "A", "A ja B", "A, B ja C" */
const listed = (names: readonly string[], last: string) => (names.length === 1 ? names[0]! : `${names.slice(0, -1).join(", ")} ${last} ${names.at(-1)}`);

/** The two sides of a debt that may be there twice: any one of the saved loans, and every account beside them. */
const sides = (t: MaybeTwice, account: string, accounts: string) =>
  `tallennettu laina ${listed(t.loans.map((l) => l.name), "tai")} ja ${t.accounts.length === 1 ? account : accounts} ${listed(t.accounts.map((a) => a.name), "ja")}`;

/** A link that ends a sentence: it opens an editor in Asetukset > Lainat. */
interface Offer {
  label: string;
  href: string;
}

/**
 * What the household can do about a debt that may be twice: link a saved loan to one of its own accounts, one link for
 * each loan beside each account. An account of another member is not offered, since only its owner's loan links to it.
 */
function offers(t: MaybeTwice, own: ReadonlySet<string>): Offer[] {
  return t.loans.flatMap((l) =>
    t.accounts
      .filter((a) => own.has(a.id))
      .map((a) => ({ label: `Liitä ${l.name} tiliin ${a.name}`, href: hashOf({ page: "settings", params: new URLSearchParams({ [LOAN_LINK_PARAM.loan]: l.id, [LOAN_LINK_PARAM.account]: a.id }), anchor: "lainat" }) })),
  );
}

/**
 * A debt that may be in the total twice, and what takes the second one out: the link of the loan to the account, which
 * counts the pair once. With no account of the household's own to link to, removing the saved loan does it.
 */
function twice(t: MaybeTwice, linkable: boolean): string {
  const fix = linkable ? "Jos velka on sama, se lasketaan kerran, kun laina liitetään tiliin." : "Jos velka on sama, poista tallennettu laina kohdassa Asetukset > Lainat, niin se lasketaan kerran.";
  return `${SAME_DEBT_TWICE}: ${sides(t, "yhdistetty tili", "yhdistetyt tilit")}. ${fix}`;
}

/**
 * A debt that may be twice in the accounts less the debts alone: an account below zero beside a saved credit line. The
 * debt total holds it once, and removing the saved loan would take it out of that total, so the sentence tells what
 * the figure would be and advises no step. Said where the figure is: its tile here and its line in Saldot.
 */
export function overdraftTwice(t: MaybeTwice): string {
  return `Sama velka voi olla luvussa ${ACCOUNTS_LESS_DEBT.label} kahdesti: ${sides(t, "miinuksella oleva yhdistetty tili", "miinuksella olevat yhdistetyt tilit")}. Jos velka on sama, oikea luku on tallennetun lainan verran suurempi.`;
}

/** A set of saved loans is one entry of its list, so its ids are a key no other sentence has. */
const idsOf = (t: MaybeTwice) => t.loans.map((l) => l.id).join(" ");

interface Note {
  key?: string;
  text: string;
  warn?: boolean;
  /** Links that end the sentence. */
  offers?: Offer[];
}

/** Whose loans these are, what a total leaves out, and a debt that may be in a figure twice. `less`: the accounts less the debts are shown. `own`: the ids of the viewer's own accounts. */
function notes(r: LoansReport, household: boolean, less: boolean, own: ReadonlySet<string>): Note[] {
  const late = r.total.unknown.filter((u) => !u.counted).length;
  const noRate = r.withoutRate;
  const { unknown, bullets } = r.payments;
  return [
    // the accounts of the household view hold what others share, the saved loans are read for the viewer alone
    ...(household ? [{ text: "Tallennetuista lainoista ovat mukana vain omasi." }] : []),
    ...(late ? [{ text: `Velan summasta puuttuu ${late === 1 ? "yksi laina, jonka jäljellä oleva summa on kirjattu tulevalle päivälle" : `${late} lainaa, joiden jäljellä oleva summa on kirjattu tulevalle päivälle`}.` }] : []),
    ...(noRate ? [{ text: `Koroista puuttuu ${loansWithout(noRate, "korkoa")}.` }] : []),
    ...(unknown ? [{ text: `Maksueristä puuttuu ${loansWithout(unknown, "maksuerää")}.` }] : []),
    ...(bullets ? [{ text: `${bullets === 1 ? "Kertalyhenteisen lainan" : "Kertalyhenteisten lainojen"} korot eivät ole mukana maksuerissä.` }] : []),
    ...r.maybeTwice.map((t) => {
      const links = offers(t, own);
      return { key: `twice ${idsOf(t)}`, text: twice(t, links.length > 0), warn: true, offers: links };
    }),
    ...(less ? r.overdraftTwice.map((t) => ({ key: `overdraft ${idsOf(t)}`, text: overdraftTwice(t), warn: true })) : []),
  ];
}

function Loans({ ctx }: SectionProps) {
  const r = ctx.data.loans;
  const b = ctx.data.balances;
  // the accounts less the debts are told for today only, as the debts are: a range that ends before today has no point for them
  const last = b.months.length - 1;
  const less = last >= 0 && b.months[last] === ctx.running ? b.accountsLessDebt[last] : undefined;
  const p = r.payments;
  // only bullets owe: there is no payment to add up, and a zero would hide the interest they pay
  const monthly = p.counted > 0 ? money(p.monthlyCents, false) : p.unknown > 0 ? FIGURE_UNKNOWN : p.bullets > 0 ? "ei maksueriä" : money(0, false);
  const items: [label: string, value: string, sub?: string][] = [
    ["Velkaa yhteensä", money(r.total.cents, false)],
    ["Korot 12 kuukaudessa", r.interestKnown ? money(r.interest.cents, false) : FIGURE_UNKNOWN],
    ["Maksuerät kuussa", monthly],
    ...(less === undefined ? [] : [[ACCOUNTS_LESS_DEBT.label, less === null ? FIGURE_UNKNOWN : money(less, false), ACCOUNTS_LESS_DEBT.sub] as [string, string, string]]),
  ];
  const lines = notes(r, ctx.scope === "household", less !== undefined, new Set(ctx.meta.accounts.map((a) => a.id)));
  return (
    <Section id={section.id} title={section.title} sub={`Tilanne ${date(r.day)}`}>
      <div className="kv">
        {items.map(([label, value, sub]) => (
          <div key={label}>
            <div className="k">{label}</div>
            <div className="v">{value}</div>
            {sub && <div className="loans-tile-sub">{sub}</div>}
          </div>
        ))}
      </div>
      {lines.length > 0 && (
        <ul className="loans-notes">
          {lines.map((n) => (
            <li key={n.key ?? n.text} className={n.warn ? "warn" : undefined}>
              {n.text}
              {n.offers?.map((o) => (
                <Fragment key={o.href}>
                  {" "}
                  <a href={o.href}>{o.label}</a>
                </Fragment>
              ))}
            </li>
          ))}
        </ul>
      )}
      <ul className="loan-list">
        {r.loans.map((l) => (
          <Loan key={l.id} l={l} />
        ))}
      </ul>
    </Section>
  );
}

export const section: ReportSection = {
  id: "lainat",
  title: "Lainat",
  // right under Saldot: what is owed after what is held
  order: 115,
  page: "reports",
  reports: ["loans", "balances"],
  // a household that saved no loan sees what it saw: its connected debts are in Saldot
  visible: (ctx) => ctx.data.loans.saved > 0,
  Component: Loans,
};
