// Decision: is the change in spending a reason to act, and where
import { bucketLabel, GAP_HELP } from "@banking/core";
import { Fragment, useState } from "react";
import { money, signedMoney } from "../../../format.ts";
import { TableToggle } from "../parts.tsx";
import { Section } from "../../../components/Section.tsx";
import type { ReportSection, SectionProps } from "../types.ts";
import "../../../styles/change.css";

type View = SectionProps["ctx"]["data"]["spendingChange"]["views"][number];
type Category = View["change"]["categories"][number];
type Merchant = Category["merchants"][number];

const SEASON = "sama kuukausi vuotta aiemmin";
const dec = (v: number) => String(v).replace(".", ",");

/** The causes of a row in words: "Kalliimpi ostoskerta +150 €; Useammin +40 €". */
const causes = (c: Pick<Category, "buckets"> | Pick<Merchant, "buckets">) => c.buckets.map((b) => `${bucketLabel(b.kind, b.cents)} ${signedMoney(b.cents)}`).join("; ");

/** The bridge: the largest causes on one axis around zero, so more and less spending read from the same line. */
function Bridge({ view }: { view: View }) {
  const [table, setTable] = useState(false);
  const widest = Math.max(1, ...view.bars.map((b) => Math.abs(b.cents)));
  return (
    <div className="bridge">
      <div className="card-head bridge-head">
        <h3 className="bridge-title">
          {money(view.change.baseCents, false)} → {money(view.change.nowCents, false)}
        </h3>
        <TableToggle table={table} onToggle={() => setTable((v) => !v)} />
      </div>
      {table ? (
        <div className="table-wrap">
          <table className="compact">
            <tbody>
              {view.bars.map((b, i) => (
                <tr key={i}>
                  <td>{b.label}</td>
                  <td className="muted">{b.cause ? `${b.cause}${b.season ? `, ${SEASON}` : ""}` : ""}</td>
                  <td className="num">{signedMoney(b.cents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="change-bars" role="img" aria-label={view.sentence}>
          {view.bars.map((b, i) => (
            <div className="change-bar" key={i}>
              <span>
                {b.label}
                {b.cause && <span className="change-cause">{b.cause}{b.season ? `, ${SEASON}` : ""}</span>}
              </span>
              <span className="change-track">
                <span className={`change-fill ${b.cents > 0 ? "up" : "down"}`} style={{ width: `${(Math.abs(b.cents) / widest) * 50}%` }} />
              </span>
              <span className="num">{signedMoney(b.cents)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Merchants({ view, category }: { view: View; category: Category }) {
  const { from, to } = view.change.target;
  return (
    <tr className="change-sub">
      <td colSpan={5}>
        <div className="table-wrap">
          <table className="compact">
            <thead>
              <tr>
                <th>Kauppa</th>
                <th className="num">Käyntejä</th>
                <th className="num">Ostoskerta</th>
                <th className="num">Muutos</th>
                <th>Syy</th>
              </tr>
            </thead>
            <tbody>
              {category.merchants.map((m) => (
                <tr key={`${m.kind}-${m.label}`}>
                  <td>{m.kind === "merchant" ? <a href={`#/transactions?merchant=${encodeURIComponent(m.label)}&category=${category.category}&from=${from}&to=${to}`}>{m.label}</a> : m.label}</td>
                  <td className="num">{m.kind === "merchant" ? `${m.visitsNow} (${dec(m.visitsBase)})` : ""}</td>
                  <td className="num">{m.ticketNowCents !== null ? `${money(m.ticketNowCents)}${m.ticketBaseCents !== null ? ` (${money(m.ticketBaseCents)})` : ""}` : ""}</td>
                  <td className="num">{signedMoney(m.changeCents)}</td>
                  <td className="muted">{causes(m)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </td>
    </tr>
  );
}

function SpendingChange({ ctx }: SectionProps) {
  const { views } = ctx.data.spendingChange;
  const [active, setActive] = useState<string>(views[0]?.view ?? "usual");
  const [open, setOpen] = useState<string | null>(null);
  const view = views.find((v) => v.view === active) ?? views[0]!;
  const { change } = view;
  return (
    <Section id={section.id} title={section.title} sub={`${view.periodLabel} verrattuna ${view.view === "usual" ? "tavalliseen kuukauteen" : "vuotta aiempaan"}`}>
      <div className="change-tabs" role="tablist">
        {views.map((v) => (
          <button key={v.view} className="btn btn-small" role="tab" aria-selected={v.view === view.view} aria-pressed={v.view === view.view} onClick={() => { setActive(v.view); setOpen(null); }}>
            {v.title}
          </button>
        ))}
      </div>
      <p className="change-sentence">{view.sentence}</p>
      <Bridge view={view} />
      <div className="table-wrap">
        <table className="change-table">
          <thead>
            <tr>
              <th>Kategoria</th>
              <th className="num">Nyt</th>
              <th className="num">{change.view === "usual" ? "Tavallisesti" : "Vertailu"}</th>
              <th className="num">Muutos</th>
              <th>Syy</th>
            </tr>
          </thead>
          <tbody>
            {change.categories.map((c) => {
              const key = c.category ?? c.kind;
              const drill = c.merchants.length > 0;
              return (
                <Fragment key={key}>
                  <tr>
                    <td>
                      {drill ? (
                        <button className="link-btn" aria-expanded={open === key} onClick={() => setOpen(open === key ? null : key)}>
                          {c.label}
                        </button>
                      ) : (
                        c.label
                      )}
                    </td>
                    <td className="num">{money(c.nowCents, false)}</td>
                    <td className="num">{money(c.baseCents, false)}</td>
                    <td className={`num ${c.changeCents > 0 ? "worse" : c.changeCents < 0 ? "better" : ""}`}>{signedMoney(c.changeCents)}</td>
                    <td className="muted">
                      {c.kind === "between" ? GAP_HELP : causes(c)}
                      {c.restCount > 0 && `${c.buckets.length ? "; " : ""}Pienet muutokset ${signedMoney(c.restCents)}`}
                      {c.season && ` (${SEASON})`}
                    </td>
                  </tr>
                  {open === key && drill && <Merchants view={view} category={c} />}
                </Fragment>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td>Yhteensä</td>
              <td className="num">{money(change.nowCents, false)}</td>
              <td className="num">{money(change.baseCents, false)}</td>
              <td className="num">{signedMoney(change.changeCents)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
    </Section>
  );
}

export const section: ReportSection = {
  id: "muutos",
  title: "Menojen muutos",
  order: 25,
  reports: ["spendingChange"],
  // a view needs three complete months before the month, or a year of history
  visible: (ctx) => ctx.data.spendingChange.views.length > 0,
  Component: SpendingChange,
};
