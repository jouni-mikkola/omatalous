// Decision: which debt to pay down first, and whether the payments hold when the reference rate moves
import { ACCOUNTS_LESS_DEBT, belowWhole, cardLimitCents, LOAN_REFERENCE_LABEL, type LoanRow, type LoansReport, type MaybeTwice, type RateScenario, SAME_DEBT_TWICE } from "@banking/core";
import { Fragment } from "react";
import { LOAN_LINK_PARAM } from "../../../components/loans/form.ts";
import { intervalLabel, KIND_LABEL } from "../../../components/loans/labels.ts";
import { Figure } from "../../../components/Figure.tsx";
import { Section } from "../../../components/Section.tsx";
import { ACCOUNT_TYPE_LABEL, date, money, percent } from "../../../format.ts";
import { typedByText } from "../../../part.ts";
import { hashOf, LOANS_REPORT_ANCHOR, SETTINGS_ANCHOR } from "../../../routes.ts";
import type { ReportSection, SectionProps } from "../types.ts";
import "../../../styles/loans.css";

/** A figure the loan has no value for: nothing is due, nothing was drawn, or the household has not told it. */
const DASH = "–";

interface LoanFigureProps {
  label: string;
  /** Null when the figure is not known: a dash. */
  value: string | null;
  sub?: string | null;
  /** Labelled values the figure is made of, each a row of its own under it. */
  parts?: readonly (readonly [label: string, value: string])[];
}

function LoanFigure({ label, value, sub, parts }: LoanFigureProps) {
  return (
    <div>
      <dt>{label}</dt>
      <dd className={value === null ? "unknown" : undefined}>
        {value ?? DASH}
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
    if (p.unknown !== null) return { value: null, parts: p.amortisationCents !== null ? [["Lyhennys", money(p.amortisationCents)]] : [] };
    // nothing is due: a bullet pays at the end, any other loan owes nothing
    return l.repayment === "bullet" && (l.balance.cents ?? 0) > 0 ? { value: "Kertalyhennys", sub: "maksetaan kerralla lopussa" } : { value: DASH };
  }
  const monthly = p.intervalMonths === 1;
  return {
    value: monthly ? `${money(p.cents)}/kk` : money(p.cents),
    sub: p.intervalMonths === null || monthly ? null : intervalLabel(p.intervalMonths).toLowerCase(),
    parts: p.interestCents !== null && p.amortisationCents !== null ? [["Korko", money(p.interestCents)], ["Lyhennys", money(p.amortisationCents)]] : [],
  };
}

/** The date of the last payment. A debt that owed nothing to begin with has none. */
function lastPayment(l: LoanRow): string | null {
  if (l.payoff.date) return date(l.payoff.date);
  if (l.payoff.never) return "Ei lyhene tällä erällä";
  return l.payoff.unknown ? null : DASH;
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

/** A word under a loan's name unless it only repeats the name: "Asuntolaina" under the name "Asuntolaina". */
const unlessName = (word: string, name: string) => (word.trim().toLowerCase() === name.trim().toLowerCase() ? null : word);

/** Where a loan's missing terms are told: the card Lainat of Asetukset. */
const SETTINGS_LOANS = hashOf({ page: "settings", params: new URLSearchParams(), anchor: SETTINGS_ANCHOR.loans });

/** `limitCents`: the limit of a connected card, when it has one to tell. */
function Loan({ l, limitCents }: { l: LoanRow; limitCents: number | null }) {
  // a connected card is a card: what is used and the limit, none of a loan's terms
  const card = l.accountType === "credit_card";
  const kind = l.accountType
    ? card
      ? null
      : ["Yhdistetty tili", unlessName(ACCOUNT_TYPE_LABEL[l.accountType] ?? l.accountType, l.name)].filter(Boolean).join(" · ")
    : [unlessName(KIND_LABEL[l.kind], l.name), l.lender].filter(Boolean).join(" · ");
  const about = [kind, typedByText(l.typedBy)].filter(Boolean).join(" · ");
  const moves = l.scenarios.map(scenario).filter((line): line is string => line !== null);
  const figures: LoanFigureProps[] = card
    ? [{ label: "Käytetty luotto", value: l.balance.cents !== null ? money(l.balance.cents) : null }, ...(limitCents !== null ? [{ label: "Luottoraja", value: money(limitCents) }] : [])]
    : [
        // a balance no plan moved forward is the one that was told, with its day
        { label: "Velkaa", value: l.balance.cents !== null ? money(l.balance.cents) : null, sub: l.balance.cents !== null && l.balance.unknown ? `jäljellä ${date(l.balanceDate)}` : null },
        { label: "Korko", value: l.rateBp !== null ? percent(l.rateBp / 10_000, 2) : null, sub: l.reference ? LOAN_REFERENCE_LABEL[l.reference] : null },
        { label: "Maksuerä", ...payment(l) },
        { label: "Korot 12 kuukaudessa", value: l.interest.cents !== null ? money(l.interest.cents, false) : null },
        { label: "Viimeinen eräpäivä", value: lastPayment(l) },
      ];
  if (belowWhole(l.part)) figures.push({ label: "Osuutesi", value: percent((l.part.to - l.part.from) / l.part.of) });
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
          <LoanFigure key={f.label} {...f} />
        ))}
      </dl>
      {moves.length > 0 && <p className="loan-scenario">{moves.join(" ")}</p>}
      {mend && (
        <a className="loan-mend" href={SETTINGS_LOANS}>
          Täydennä
        </a>
      )}
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
 * each loan beside each account. An account of another member is not offered, since only its owner's loan links to it,
 * and neither is a loan another member typed in (`typists`, by loan id): its editor opens for its typist alone.
 */
function offers(t: MaybeTwice, own: ReadonlySet<string>, typists: ReadonlyMap<string, string>): Offer[] {
  return t.loans
    .filter((l) => !typists.has(l.id))
    .flatMap((l) =>
      t.accounts
        .filter((a) => own.has(a.id))
        .map((a) => ({ label: `Liitä ${l.name} tiliin ${a.name}`, href: hashOf({ page: "settings", params: new URLSearchParams({ [LOAN_LINK_PARAM.loan]: l.id, [LOAN_LINK_PARAM.account]: a.id }), anchor: SETTINGS_ANCHOR.loans }) })),
    );
}

/** Who typed in the saved loans of a set when none of them is the viewer's own: only they can remove one. Nobody when the viewer has a loan in it. */
const removers = (t: MaybeTwice, typists: ReadonlyMap<string, string>): string[] => (t.loans.every((l) => typists.has(l.id)) ? [...new Set(t.loans.map((l) => typists.get(l.id)!))] : []);

/**
 * A debt that may be in the total twice, and what takes the second one out: the link of the loan to the account, which
 * counts the pair once. With no account of the household's own to link to, removing the saved loan does it: the viewer
 * removes their own, and `others` names who can when every saved loan of the set is another member's.
 */
function twice(t: MaybeTwice, linkable: boolean, others: readonly string[]): string {
  const remove = others.length ? `${listed(others, "tai")} voi poistaa tallennetun lainan` : "poista tallennettu laina";
  const fix = linkable ? "Jos velka on sama, se lasketaan kerran, kun laina liitetään tiliin." : `Jos velka on sama, ${remove} kohdassa Asetukset > Lainat, niin se lasketaan kerran.`;
  return `${SAME_DEBT_TWICE}: ${sides(t, "yhdistetty tili", "yhdistetyt tilit")}. ${fix}`;
}

/**
 * A debt that may be twice in the accounts less the debts alone: an account below zero beside a saved credit line. The
 * debt total holds it once, and removing the saved loan would take it out of that total, so the sentence tells what
 * the figure would be and advises no step. Said where the figure is: its tile here and its line in Saldot.
 */
export function overdraftTwice(): string {
  return `Jos tallentamasi laina näkyy myös pankin tiedoissa, se on luvussa ${ACCOUNTS_LESS_DEBT.label} kahdesti. Silloin oikea luku on lainan verran suurempi.`;
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

/** What the debt total leaves out, and a debt that may be in a figure twice. `less`: the accounts less the debts are shown. `own`: the ids of the viewer's own accounts. */
function notes(r: LoansReport, less: boolean, own: ReadonlySet<string>): Note[] {
  const late = r.total.unknown.filter((u) => !u.counted).length;
  const typists = new Map(r.loans.flatMap((l): [string, string][] => (l.typedBy ? [[l.id, l.typedBy]] : [])));
  return [
    ...(late ? [{ text: `Velan summasta puuttuu ${late === 1 ? "yksi laina, jonka jäljellä oleva summa on kirjattu tulevalle päivälle" : `${late} lainaa, joiden jäljellä oleva summa on kirjattu tulevalle päivälle`}.` }] : []),
    ...r.maybeTwice.map((t) => {
      const links = offers(t, own, typists);
      return { key: `twice ${idsOf(t)}`, text: twice(t, links.length > 0, removers(t, typists)), warn: true, offers: links };
    }),
    ...(less && r.overdraftTwice.length > 0 ? [{ key: "overdraft", text: overdraftTwice(), warn: true }] : []),
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
  const monthly = p.counted > 0 ? money(p.monthlyCents, false) : p.unknown > 0 ? DASH : p.bullets > 0 ? "ei maksueriä" : money(0, false);
  const items: [label: string, value: string, sub?: string][] = [
    ["Velkaa yhteensä", money(r.total.cents, false)],
    ["Korot 12 kuukaudessa", r.interestKnown ? money(r.interest.cents, false) : DASH],
    ["Maksuerät kuussa", monthly],
    ...(less === undefined ? [] : [[ACCOUNTS_LESS_DEBT.label, less === null ? DASH : money(less, false), ACCOUNTS_LESS_DEBT.sub] as [string, string, string]]),
  ];
  const lines = notes(r, less !== undefined, new Set(ctx.meta.accounts.map((a) => a.id)));
  // the limit of a connected card is the account's own: a card at a part shows the viewer's part of what is used, and no limit beside it
  const limitOf = (l: LoanRow) => (l.accountType === "credit_card" && !belowWhole(l.part) ? cardLimitCents(ctx.meta.accounts.find((a) => `account:${a.id}` === l.id)?.creditLimitCents) : null);
  return (
    <Section id={section.id} title={section.title}>
      <div className="kv">
        {items.map(([label, value, sub]) => (
          <div key={label}>
            <div className="k">{label}</div>
            <div className="v"><Figure text={value} size="m" /></div>
            {sub && <div className="loans-tile-sub">{sub}</div>}
          </div>
        ))}
      </div>
      {lines.length > 0 && (
        <ul className="loans-notes">
          {lines.map((n) => (
            <li key={n.key ?? n.text} className={n.warn ? "notice warning" : undefined}>
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
          <Loan key={l.id} l={l} limitCents={limitOf(l)} />
        ))}
      </ul>
    </Section>
  );
}

export const section: ReportSection = {
  id: LOANS_REPORT_ANCHOR,
  title: "Lainat",
  // right under Saldot: what is owed after what is held
  order: 115,
  page: "reports",
  reports: ["loans", "balances"],
  // a household that saved no loan sees what it saw: its connected debts are in Saldot
  visible: (ctx) => ctx.data.loans.saved > 0,
  Component: Loans,
};
