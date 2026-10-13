// Decision: which of the food lines to look at first, and whether the bill grew by visits or by dearer baskets
import { monthRange } from "@banking/core";
import { Fragment, useState } from "react";
import { MonthColumns } from "../../../charts/MonthColumns.tsx";
import { Section } from "../../../components/Section.tsx";
import { TableToggle } from "../../../components/TableToggle.tsx";
import { money, monthLong, percent, roundedShares, shareText, signedMoney } from "../../../format.ts";
import type { ReportsData } from "../../../types.ts";
import type { ReportSection, SectionProps } from "../types.ts";
import "../../../styles/statement.css";
import "../../../styles/overview.css";
import "../../../styles/themes-table.css";
import "../../../styles/food.css";

type FoodReport = NonNullable<ReportsData["food"]>;
type Line = FoodReport["lines"][number];

const DASH = "–";
/** Monday first, as the report counts. */
const WEEKDAYS = ["Ma", "Ti", "Ke", "To", "Pe", "La", "Su"];
/** "2025-10" gives "10/2025", as Menot kategorioittain prints its months. */
const monthYear = (month: string) => `${Number(month.slice(5, 7))}/${month.slice(0, 4)}`;
/** Visits a month with a decimal comma; a whole number has none. */
const count = (x: number | null) => (x === null ? DASH : String(x).replace(".", ","));
const orDash = (cents: number | null) => (cents === null ? DASH : money(cents));

/** The label that opens and closes the rows under it, the one Menot kategorioittain has. */
function Toggle({ id, label, open, onToggle }: { id: string; label: string; open: boolean; onToggle: (id: string) => void }) {
  return (
    <button type="button" className="themes-toggle" aria-expanded={open} onClick={() => onToggle(id)}>
      <span className="themes-label">{label}</span>
    </button>
  );
}

function MonthsTable({ line, names }: { line: Line; names: string[] }) {
  return (
    <div className="table-wrap">
      <table className="compact food-months">
        <thead>
          <tr>
            <th>Kuukausi</th>
            <th className="num">Summa</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {names.map((m, i) => (
            <tr key={m} className={i === line.dearest ? "food-dearest" : undefined}>
              <td>{monthLong(m)}</td>
              <td className="num">{money(line.monthCents[i]!)}</td>
              <td>{i === line.dearest ? "Kallein" : ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Purchases by weekday: a bar for each of the seven days, or the same figures as a table. */
function Weekdays({ days, table }: { days: number[]; table: boolean }) {
  const total = days.reduce((a, b) => a + b, 0);
  const top = Math.max(...days, 1);
  const weekend = days[4]! + days[5]! + days[6]!;
  return (
    <div className="food-part">
      <div className="themes-head">
        <h3 className="st-cap">Viikonpäivät</h3>
        <span className="st-num">{`Pe–su ${percent(weekend / total)}`}</span>
      </div>
      <table className="st-table food-days">
        <tbody>
          {days.map((n, i) => (
            <tr key={WEEKDAYS[i]}>
              <th scope="row">{WEEKDAYS[i]}</th>
              {!table && <td className="category-bar">{n > 0 && <span style={{ width: `${Math.round((n / top) * 10000) / 100}%` }} />}</td>}
              <td className="st-num">{n}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Basket({ basket }: { basket: NonNullable<FoodReport["basket"]> }) {
  return (
    <div className="food-part">
      <table className="st-table food-basket">
        <thead>
          <tr>
            <td />
            <th scope="col" className="st-num">
              Viimeiset kolme kuukautta
            </th>
            <th scope="col" className="st-num">
              Sitä ennen
            </th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <th scope="row">Ostoskerta keskimäärin</th>
            <td className="st-num">{orDash(basket.now.meanCents)}</td>
            <td className="st-num">{orDash(basket.before.meanCents)}</td>
          </tr>
          <tr>
            <th scope="row">Kertaa kuussa</th>
            <td className="st-num">{count(basket.now.perMonth)}</td>
            <td className="st-num">{count(basket.before.perMonth)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

/** What one open line holds: its months, its payees, its weekdays and for Ruokakauppa the basket. */
function LineDetail({ line, report }: { line: Line; report: FoodReport }) {
  const [table, setTable] = useState(false);
  const [hover, setHover] = useState<number | null>(null);
  // the dearest month stands marked until another is picked
  const [pinned, setPinned] = useState(line.dearest ?? -1);
  const names = monthRange(report.window.first, report.window.last);
  return (
    <div className="food-open">
      <div className="food-view">
        <TableToggle table={table} onChange={setTable} />
      </div>
      <div className="food-part">
        <h3 className="st-cap">Kuukausittain</h3>
        {table ? (
          <MonthsTable line={line} names={names} />
        ) : (
          <MonthColumns
            months={names}
            values={line.monthCents}
            average={null}
            inPeriod={() => true}
            complete={names.map(() => true)}
            active={hover ?? pinned}
            pinned={pinned}
            onHover={setHover}
            onPick={(i) => setPinned((p) => (p === i ? -1 : i))}
            height={170}
          />
        )}
      </div>
      {line.payees.length > 0 && (
        <div className="food-part">
          <h3 className="st-cap">Kauppiaat</h3>
          <ul className="st-rows">
            {line.payees.map((p) => (
              <li className="st-row" key={p.payee}>
                <span className="st-name" title={p.payee}>
                  {p.payee}
                </span>
                <span className="st-num">{money(p.cents)}</span>
              </li>
            ))}
            {line.otherCents !== 0 && (
              <li className="st-row">
                <span className="st-name">Muut</span>
                <span className="st-num">{money(line.otherCents)}</span>
              </li>
            )}
          </ul>
        </div>
      )}
      {line.weekdays && <Weekdays days={line.weekdays} table={table} />}
      {line.id === "groceries" && report.basket && <Basket basket={report.basket} />}
    </div>
  );
}

function Food({ ctx }: SectionProps) {
  const r = ctx.data.food!;
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const toggle = (id: string) =>
    setOpen((was) => {
      const next = new Set(was);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  // the shares of the lines that spent: a line at or under zero has none
  const shares = roundedShares(
    r.lines.map((l) => (l.cents > 0 ? l.cents : null)),
    r.lines.reduce((s, l) => s + Math.max(0, l.cents), 0),
  );
  const change = r.lines.some((l) => l.changeCents !== null);
  return (
    <Section id={section.id} title={section.title} datum={`${monthYear(r.window.first)}–${monthYear(r.window.last)}`}>
      <table className="st-table food-table" aria-label="Ruoka">
        <thead>
          <tr>
            <td />
            <th scope="col" className="st-num food-month">
              Kuukaudessa
            </th>
            <th scope="col" className="st-num food-share">
              Osuus
            </th>
            <th scope="col" className="st-num food-week">
              Viikossa
            </th>
            <th scope="col" className="st-num food-mean">
              Ostoskerta keskimäärin
            </th>
            <th scope="col" className="st-num food-visits">
              Kertaa kuussa
            </th>
            {change && (
              <th scope="col" className="st-num food-change">
                Muutos
              </th>
            )}
          </tr>
        </thead>
        {r.cardBills && (
          <tbody className="food-bills">
            <tr>
              <th scope="row" className="st-cut" title="Luottokortin laskut">
                <span className="themes-plain">Luottokortin laskut</span>
              </th>
              <td className="st-num food-month">{money(r.cardBills.monthlyCents)}</td>
              <td className="food-share" />
              <td className="food-week" />
              <td className="food-mean" />
              <td className="food-visits" />
              {change && <td className="food-change" />}
            </tr>
          </tbody>
        )}
        <tbody>
          {r.lines.map((l, i) => (
            <Fragment key={l.id}>
              <tr className="food-line">
                <th scope="row" className="st-cut" title={l.heading}>
                  {l.monthCents.some((c) => c !== 0) ? <Toggle id={l.id} label={l.heading} open={open.has(l.id)} onToggle={toggle} /> : <span className="themes-plain">{l.heading}</span>}
                </th>
                <td className="st-num food-month">{money(l.monthlyCents)}</td>
                <td className="st-num food-share">{shares[i] == null ? DASH : shareText(shares[i])}</td>
                <td className="st-num food-week">{orDash(l.weekCents)}</td>
                <td className="st-num food-mean">{orDash(l.meanCents)}</td>
                <td className="st-num food-visits">{count(l.perMonth)}</td>
                {change && <td className="st-num food-change">{l.changeCents === null ? "" : signedMoney(l.changeCents)}</td>}
              </tr>
              {open.has(l.id) && (
                <tr className="food-open-row">
                  <td colSpan={change ? 7 : 6}>
                    <LineDetail line={l} report={r} />
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
          <tr className="food-total">
            <th scope="row">Yhteensä</th>
            <td className="st-num food-month">{money(r.monthlyCents)}</td>
            <td className="food-share" />
            <td className="food-week" />
            <td className="food-mean" />
            <td className="food-visits" />
            {change && <td className="food-change" />}
          </tr>
        </tbody>
      </table>
    </Section>
  );
}

export const section: ReportSection = {
  id: "ruoka",
  title: "Ruoka",
  order: 35,
  page: "reports",
  reports: ["food"],
  // under three months there is no window, and without food there is nothing to tell
  visible: (ctx) => ctx.data.food != null,
  Component: Food,
};
