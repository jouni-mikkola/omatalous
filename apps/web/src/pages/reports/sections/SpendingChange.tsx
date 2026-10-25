// Decision: is the change in spending a reason to act, and where
import { Table } from "../../../components/table/Table.tsx";
import { bucketLabel } from "@banking/core";
import { useState } from "react";
import { money, signedMoney } from "../../../format.ts";
import { QuestionChart, ReportPanel } from "../../../charts/forms/parts.tsx";
import type { ReportSection, SectionProps } from "../types.ts";
import "../../../styles/change.css";

type View = SectionProps["ctx"]["data"]["spendingChange"]["views"][number];
type Category = View["change"]["categories"][number];
type Merchant = Category["merchants"][number];

const SEASON = "sama kuukausi vuotta aiemmin";
const dec = (v: number) => String(v).replace(".", ",");

/** The causes of a row in words: "Kalliimpi ostoskerta +150 €; Useammin +40 €". */
const causes = (c: Pick<Category, "buckets"> | Pick<Merchant, "buckets">, bills = false) => c.buckets.map((b) => `${bucketLabel(b.kind, b.cents, bills)} ${signedMoney(b.cents)}`).join("; ");

/** The bars of the change as a table: the panel's switch shows it in place of the bars. */
function BridgeTable({ view }: { view: View }) {
  return (
    <Table
      caption="Mikä muuttui ja miksi"
      rows={view.bars.map((b, i) => ({ ...b, i }))}
      rowKey={(b) => String(b.i)}
      columns={[
        { key: "label", label: "Mikä muuttui", kind: "text", rowHead: true, cell: (b) => b.label },
        { key: "cause", label: "Syy", kind: "text", cell: (b) => <span className="muted">{b.cause ? `${b.cause}${b.season ? `, ${SEASON}` : ""}` : ""}</span> },
        { key: "change", label: "Muutos", kind: "money", main: true, cell: (b) => signedMoney(b.cents), sort: (b) => b.cents },
      ]}
    />
  );
}

/** The bridge: the largest causes on one axis around zero, so more and less spending read from the same line, each bar labelled with its figure. */
function Bridge({ view }: { view: View }) {
  // geometry only: a bar's length is its share of the widest bar
  const widest = Math.max(1, ...view.bars.map((b) => Math.abs(b.cents)));
  return (
    <div className="change-bars" role="img" aria-label={view.sentence}>
      {view.bars.map((b, i) => (
        <div className="change-bar" key={i}>
          <span>
            {b.label}
            {b.cause && (
              <span className="change-cause">
                {b.cause}
                {b.season ? `, ${SEASON}` : ""}
              </span>
            )}
          </span>
          <span className="change-track">
            <span className={`change-fill ${b.cents > 0 ? "up" : "down"}`} style={{ width: `${(Math.abs(b.cents) / widest) * 50}%` }} />
          </span>
          <span className={`num ${b.cents > 0 ? "worse" : b.cents < 0 ? "better" : ""}`}>{signedMoney(b.cents)}</span>
        </div>
      ))}
    </div>
  );
}

function Merchants({ view, category }: { view: View; category: Category }) {
  const { from, to } = view.change.target;
  return (
    <div>
      <Table
          caption={`Saajat kategoriassa ${category.label}`}
          rows={category.merchants}
          rowKey={(m) => `${m.kind}-${m.label}`}
          columns={[
            { key: "payee", label: "Saaja", kind: "text", rowHead: true, cell: (m) => (m.kind === "merchant" ? <a href={`#/transactions?merchant=${encodeURIComponent(m.label)}&category=${category.category}&from=${from}&to=${to}`}>{m.label}</a> : m.label) },
            { key: "visits", label: "Käyntejä", kind: "count", cell: (m) => (m.kind === "merchant" ? `${m.visitsNow} (${dec(m.visitsBase)})` : ""), sort: (m) => (m.kind === "merchant" ? m.visitsNow : null) },
            { key: "ticket", label: "Ostoskerta", kind: "money", phone: "hide", cell: (m) => (m.ticketNowCents !== null ? `${money(m.ticketNowCents)}${m.ticketBaseCents !== null ? ` (${money(m.ticketBaseCents)})` : ""}` : ""), sort: (m) => m.ticketNowCents },
            { key: "change", label: "Muutos", kind: "money", main: true, cell: (m) => signedMoney(m.changeCents), sort: (m) => m.changeCents },
            { key: "cause", label: "Syy", kind: "text", cell: (m) => <span className="muted">{causes(m)}</span> },
          ]}
      />
    </div>
  );
}

function SpendingChange({ ctx }: SectionProps) {
  const { views } = ctx.data.spendingChange;
  const [active, setActive] = useState<string>(views[0]?.view ?? "usual");
  const view = views.find((v) => v.view === active) ?? views[0]!;
  const { change } = view;
  return (
    <ReportPanel id={section.id} title={section.title} datum={`Muutos ${signedMoney(change.changeCents)}`}>
      <div className="change-tabs segmented" role="tablist">
        {views.map((v) => (
          <button key={v.view} role="tab" aria-selected={v.view === view.view} aria-pressed={v.view === view.view} onClick={() => { setActive(v.view); }}>
            {v.title}
          </button>
        ))}
      </div>
      <QuestionChart
        id="muutos-syyt"
        question={view.view === "usual" ? `Mikä oli ${view.periodLabel.toLowerCase()}ssa tavallista suurempaa tai pienempää?` : "Mikä muuttui vuoden takaisesta?"}
        answer={view.sentence}
        table={<BridgeTable view={view} />}
      >
        {/* no category stands out: no bars, the table below totals the change */}
        {view.bars.length > 0 && <Bridge view={view} />}
      </QuestionChart>
      <Table
        key={view.view}
        caption="Menojen muutos kategorioittain"
        className="change-table"
        rows={change.categories}
        rowKey={(c) => c.category ?? c.kind}
        columns={[
          { key: "category", label: "Kategoria", kind: "text", rowHead: true, cell: (c) => c.label },
          { key: "now", label: "Nyt", kind: "money", cents: (c) => c.nowCents },
          { key: "base", label: change.view === "usual" ? "Tavallisesti" : "Vertailu", kind: "money", phone: "hide", cents: (c) => c.baseCents },
          {
            key: "change",
            label: "Muutos",
            kind: "money",
            main: true,
            cell: (c) => signedMoney(c.changeCents),
            sort: (c) => c.changeCents,
            className: (c) => (c.changeCents > 0 ? "worse" : c.changeCents < 0 ? "better" : undefined),
          },
          {
            key: "cause",
            label: "Syy",
            kind: "text",
            cell: (c) => (
              <span className="muted">
                {causes(c, c.bills)}
                {c.restCount > 0 && `${c.buckets.length ? "; pienet muutokset" : "Pienet muutokset"} ${signedMoney(c.restCents)}`}
                {c.season && ` (${SEASON})`}
              </span>
            ),
          },
        ]}
        drill={(c) => (c.merchants.length > 0 ? <Merchants view={view} category={c} /> : null)}
        drillLabel={(c) => `Saajat kategoriassa ${c.label}`}
        total={{
          label: "Yhteensä",
          cells: { now: money(change.nowCents, false), base: money(change.baseCents, false), change: signedMoney(change.changeCents) },
        }}
      />
    </ReportPanel>
  );
}

export const section: ReportSection = {
  id: "muutos",
  title: "Menojen muutos",
  order: 25,
  // why last month differed: Yhteenveto, the month before the running one, in place of the month table
  page: "month",
  reports: ["spendingChange"],
  // a view needs three complete months before the month, or a year of history
  visible: (ctx) => ctx.data.spendingChange.views.length > 0,
  Component: SpendingChange,
};
