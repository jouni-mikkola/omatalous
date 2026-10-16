// Decision: is our income changing, and does the buffer match how it moves
import type { IncomeChange, IncomeReport, IncomeTypeRow } from "@banking/core";
import { Fragment, type ReactNode, useState } from "react";
import { date, money, monthLong, percent, plural, roundedShares, shareText } from "../../../format.ts";
import { hasJointAccount } from "../../../part.ts";
import { Why } from "../../../components/Why.tsx";
import type { ReportContext } from "../types.ts";
import "../../../styles/income.css";
import { Kv } from "../parts.tsx";
import { Section } from "../../../components/Section.tsx";
import type { ReportSection, SectionProps } from "../types.ts";

function signedPercent(x: number): string {
  if (Math.round(x * 100) === 0) return "±0 %";
  return x > 0 ? `+${percent(x)}` : percent(x);
}

const rowsHref = (payer: string, r: IncomeReport) => `#/transactions?merchant=${encodeURIComponent(payer)}&from=${r.months[0]!.month}-01`;

/** The changes of the usual income; the section mounts it only when there are some. */
function Changes({ r }: { r: IncomeReport }) {
  const [all, setAll] = useState(false);
  const shown: IncomeChange[] = all ? r.changes : r.changes.slice(0, 3);
  return (
    <>
      <ul className="income-changes">
        {shown.map((c) => (
          <li key={c.id} className={c.monthlyCents < 0 ? "down" : "up"}>
            <strong>{c.title}</strong>
            <span className="muted">{c.detail}</span>
            {c.payer && (
              <a href={rowsHref(c.payer, r)} className="income-link">
                Tapahtumat
              </a>
            )}
          </li>
        ))}
      </ul>
      {r.changes.length > 3 && (
        <button className="btn btn-small" onClick={() => setAll((v) => !v)} aria-expanded={all}>
          {all ? "Näytä vähemmän" : `Näytä kaikki (${r.changes.length})`}
        </button>
      )}
    </>
  );
}

/** Type, then payer, then rows: each level opens under the one above it. */
function Types({ r }: { r: IncomeReport }) {
  const [openType, setOpenType] = useState<string | null>(null);
  const [openPayer, setOpenPayer] = useState<string | null>(null);
  const toggle = (t: IncomeTypeRow) => {
    setOpenType((v) => (v === t.type ? null : t.type));
    setOpenPayer(null);
  };
  // the shares of the earned types are parts of the earned income: rounded together they add up to the 100 % it is
  const units = roundedShares(r.types.map((t) => (t.share === null ? null : t.totalCents)), r.earnedCents);
  return (
    <div className="table-wrap">
      <table className="income-types ruled">
        <thead>
          <tr>
            <th>Tulolaji</th>
            <th className="num">Yhteensä</th>
            <th className="num">Kuussa</th>
            <th className="num">Osuus</th>
          </tr>
        </thead>
        <tbody>
          {r.types.map((t, ti) => (
            <Fragment key={t.type}>
              <tr>
                <td>
                  <button className="link-button" onClick={() => toggle(t)} aria-expanded={openType === t.type}>
                    {t.label}
                  </button>
                </td>
                <td className="num">{money(t.totalCents, false)}</td>
                <td className="num">{t.monthlyCents === null ? "–" : money(t.monthlyCents, false)}</td>
                <td className="num">{t.share === null ? "–" : units[ti] == null ? percent(t.share) : shareText(units[ti]!)}</td>
              </tr>
              {openType === t.type &&
                t.payers.map((p) => {
                  const key = `${t.type}|${p.payer}`;
                  return (
                    <Fragment key={key}>
                      <tr className="income-payer">
                        <td>
                          <button className="link-button" onClick={() => setOpenPayer((v) => (v === key ? null : key))} aria-expanded={openPayer === key}>
                            {p.payer}
                          </button>
                          <span className="income-note">
                            {plural(p.payments, "maksu", "maksua")}, tavallisesti {money(p.usualCents)}
                            {p.nextDate ? `, seuraava ${date(p.nextDate)}` : `, viimeksi ${date(p.lastDate)}`}
                          </span>
                        </td>
                        <td className="num">{money(p.totalCents, false)}</td>
                        <td />
                        <td />
                      </tr>
                      {openPayer === key && (
                        <tr className="income-rows">
                          <td colSpan={4}>
                            <ul>
                              {p.rows.map((x) => (
                                <li key={x.id}>
                                  <span>{date(x.date)}</span>
                                  <span className="num">{money(x.amountCents)}</span>
                                </li>
                              ))}
                            </ul>
                            <a href={rowsHref(p.payer, r)}>Näytä tapahtumat</a>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Year({ r }: { r: IncomeReport }) {
  // a column for each group that took in money in some month; a phone has the total alone, the split by type is in Tulolajit
  const used = r.groups.filter((g) => r.months.some((m) => m.byGroup[g.id] > 0));
  return (
    <div className="income-year">
      <h3>Kuukausittain</h3>
      <div className="table-wrap">
        <table className="ruled">
          <thead>
            <tr>
              <th>Kuukausi</th>
              {used.map((g) => (
                <th key={g.id} className="num hide-phone">
                  {g.label}
                </th>
              ))}
              <th className="num">Yhteensä</th>
            </tr>
          </thead>
          <tbody>
            {r.months.map((m) => (
              <tr key={m.month}>
                <td>
                  {monthLong(m.month)}
                  {m.complete ? "" : " (vajaa)"}
                </td>
                {used.map((g) => (
                  <td key={g.id} className="num hide-phone">
                    {money(m.byGroup[g.id], false)}
                  </td>
                ))}
                <td className="num">
                  <strong>{money(m.totalCents, false)}</strong>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** The usual income and how much it moves; with too short a history there is nothing to tell, and nothing is drawn. */
function Stability({ r, ctx }: { r: IncomeReport; ctx: ReportContext }) {
  const s = r.stability;
  if (!s) return null;
  // the usual level of the month the period ends in, from the months before it
  const usual: [string, string, ReactNode] = ["Tavalliset tulot kuukaudessa", money(s.medianCents, false), <Why key="why" figure="usual.income" title="Tavalliset tulot kuukaudessa" range={ctx.range} scope={ctx.scope} />];
  const weeks = s.worstRunWeeks.toLocaleString("fi-FI", { maximumFractionDigits: 1 });
  return (
    <>
      <h3>Vaihtelu</h3>
      {s.steady ? (
        <Kv items={[usual, ["Vaihtelu kuukaudesta toiseen", `alle ${percent(r.needs.steadySpread)}`]]} />
      ) : (
        <>
          <Kv items={[usual, ["Vaihtelu kuukaudesta toiseen", percent(s.spread)], ["Heikoin kuukausi", `${monthLong(s.lowMonth)}, ${money(s.lowCents, false)}`]]} />
          <p>
            Heikoin kuukausi oli {percent(s.lowShare)} tavallista pienempi. Suurin vajaus peräkkäisinä kuukausina oli {money(s.worstRunCents, false)} eli {weeks} viikon tulot.
          </p>
        </>
      )}
    </>
  );
}

/**
 * The report's twelve months from the first one with data: the months before the history starts are empty and
 * incomplete, and Viime vuosi of a history from September would show eight of them.
 */
function fromHistory(months: IncomeReport["months"]): IncomeReport["months"] {
  const start = months.findIndex((m) => m.complete || m.totalCents !== 0);
  return start < 0 ? months : months.slice(start);
}

function Income({ ctx }: SectionProps) {
  const r = { ...ctx.data.income, months: fromHistory(ctx.data.income.months) };
  const change = r.earnedChange;
  return (
    <Section id={section.id} title={section.title} half>
      <Kv
        items={[
          // what reached the accounts, after tax: not the gross ansiotulo of taxation
          [`Nettotulot ${r.months.length} kuukaudessa`, money(r.earnedCents, false)],
          ...(change === null ? [] : ([["Edellisestä 12 kuukaudesta", signedPercent(change)]] as [string, string][])),
          ...(r.notEarnedCents ? ([["Maksut henkilöiltä ja hyvitykset", money(r.notEarnedCents, false)]] as [string, string][]) : []),
        ]}
      />
      {r.changes.length > 0 && (
        <>
          <h3>Mikä muuttui</h3>
          <Changes r={r} />
        </>
      )}
      <h3>Tulolajit</h3>
      <Types r={r} />
      <Year r={r} />
      {r.payDays.length > 0 && (
        <>
          <h3>Maksupäivät</h3>
          <ul className="income-paydays">
            {r.payDays.map((p) => (
              <li key={`${p.label}|${p.payer}`}>
                {p.label}
                {p.label === "Palkka" ? ` (${p.payer})` : ""}: {p.text}
                {p.nextDate ? `, seuraava ${date(p.nextDate)}` : ""}, {money(p.usualCents, false)}
              </li>
            ))}
          </ul>
        </>
      )}
      <Stability r={r} ctx={ctx} />
      {r.members && (
        <>
          <h3>Jäsenittäin</h3>
          <ul className="income-paydays">
            {r.members.map((m) => (
              <li key={m.label}>
                {m.label}: {money(m.earnedCents, false)}
                {!m.regular && <span className="income-note">Palkkaa tai etuuksia ei näy jaetuilla tileillä.</span>}
              </li>
            ))}
          </ul>
          {hasJointAccount(ctx.meta) && <p className="income-caption">Yhteisen tilin tulot on jaettu käyttäjien osuuksien mukaan.</p>}
        </>
      )}
    </Section>
  );
}

export const section: ReportSection = {
  id: "tulot",
  title: "Tulot",
  order: 25,
  page: "reports",
  reports: ["income"],
  // a history too short to split the income into types has nothing to tell: the section is left out until it has
  visible: (ctx) => ctx.data.income.enough,
  Component: Income,
};
