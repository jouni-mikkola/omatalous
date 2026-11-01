// Decision: is the change in spending a reason to act, and where
import { Table } from "../../../components/table/Table.tsx";
import { bucketLabel } from "@banking/core";
import { useState } from "react";
import { language, money, signedMoney } from "../../../format.ts";
import { QuestionChart, ReportPanel } from "../../../charts/forms/parts.tsx";
import { inSpan } from "../parts.tsx";
import type { ReportSection, SectionProps } from "../types.ts";
import "../../../styles/change.css";

import { Segmented } from "../../../components/ui/Segmented.tsx";
import { css } from "../../../css.ts";
import { t } from "../../../text.ts";
type View = SectionProps["ctx"]["data"]["spendingChange"]["views"][number];
type Category = View["change"]["categories"][number];
type Merchant = Category["merchants"][number];

const season = () => t("rpt.sc_season");
const dec = (v: number) => (language() === "en" ? String(v) : String(v).replace(".", ","));

/** The causes of a row in words: "Kalliimpi ostoskerta +150 €; Useammin +40 €". */
const causes = (c: Pick<Category, "buckets"> | Pick<Merchant, "buckets">, bills = false) => c.buckets.map((b) => `${bucketLabel(b.kind, b.cents, bills, language())} ${signedMoney(b.cents)}`).join("; ");

/** The bars of the change as a table: the panel's switch shows it in place of the bars. */
function BridgeTable({ view }: { view: View }) {
  return (
    <Table
      caption={t("rpt.sc_bridge_caption")}
      rows={view.bars.map((b, i) => ({ ...b, i }))}
      rowKey={(b) => String(b.i)}
      columns={[
        { key: "label", label: t("rpt.sc_what"), kind: "text", rowHead: true, cell: (b) => b.label },
        { key: "cause", label: t("rpt.sc_cause"), kind: "text", cell: (b) => <span className="muted">{b.cause ? `${b.cause}${b.season ? `, ${season()}` : ""}` : ""}</span> },
        { key: "change", label: t("rpt.change"), kind: "money", main: true, cell: (b) => signedMoney(b.cents), sort: (b) => b.cents },
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
                {b.season ? `, ${season()}` : ""}
              </span>
            )}
          </span>
          <span className="change-track">
            <span className={`change-fill ${b.cents > 0 ? "up" : "down"}`} ref={css({ width: `${(Math.abs(b.cents) / widest) * 50}%` })} />
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
          caption={t("rpt.sc_payees", { category: category.label })}
          rows={category.merchants}
          rowKey={(m) => `${m.kind}-${m.label}`}
          columns={[
            { key: "payee", label: t("rpt.payee"), kind: "text", rowHead: true, cell: (m) => (m.kind === "merchant" ? <a href={`#/transactions?merchant=${encodeURIComponent(m.label)}&category=${category.category}&from=${from}&to=${to}`}>{m.label}</a> : m.label) },
            { key: "visits", label: t("rpt.sc_visits"), kind: "count", cell: (m) => (m.kind === "merchant" ? `${m.visitsNow} (${dec(m.visitsBase)})` : ""), sort: (m) => (m.kind === "merchant" ? m.visitsNow : null) },
            { key: "ticket", label: t("rpt.sc_ticket"), kind: "money", phone: "hide", cell: (m) => (m.ticketNowCents !== null ? `${money(m.ticketNowCents)}${m.ticketBaseCents !== null ? ` (${money(m.ticketBaseCents)})` : ""}` : ""), sort: (m) => m.ticketNowCents },
            { key: "change", label: t("rpt.change"), kind: "money", main: true, cell: (m) => signedMoney(m.changeCents), sort: (m) => m.changeCents },
            { key: "cause", label: t("rpt.sc_cause"), kind: "text", cell: (m) => <span className="muted">{causes(m)}</span> },
          ]}
      />
    </div>
  );
}

function SpendingChange({ ctx }: SectionProps) {
  const { views } = ctx.data.spendingChange;
  const [active, setActive] = useState<string>(views[0]?.view ?? "expected");
  const view = views.find((v) => v.view === active) ?? views[0]!;
  const { change } = view;
  return (
    <ReportPanel id={section.id} title={section.title} datum={inSpan(ctx, t("rpt.sc_datum", { amount: signedMoney(change.changeCents) }))}>
      <Segmented
        className="change-tabs"
        label={t("rpt.comparison")}
        value={view.view}
        options={views.map((v) => ({ value: v.view, label: v.title }))}
        onChange={setActive}
      />
      <QuestionChart
        id="muutos-syyt"
        question={view.view === "expected" ? t("rpt.sc_q_expected") : t("rpt.sc_q_year")}
        answer={view.sentence}
        table={<BridgeTable view={view} />}
      >
        {/* no category stands out: no bars, the table below totals the change */}
        {view.bars.length > 0 && <Bridge view={view} />}
      </QuestionChart>
      <Table
        key={view.view}
        caption={t("rpt.sc_table")}
        className="change-table"
        rows={change.categories}
        rowKey={(c) => c.category ?? c.kind}
        columns={[
          { key: "category", label: t("rpt.category"), kind: "text", rowHead: true, cell: (c) => c.label },
          { key: "now", label: t("rpt.sc_now"), kind: "money", cents: (c) => c.nowCents },
          { key: "base", label: change.view === "expected" ? t("rpt.tm_expected") : t("rpt.comparison"), kind: "money", phone: "hide", cents: (c) => c.baseCents },
          {
            key: "change",
            label: t("rpt.change"),
            kind: "money",
            main: true,
            cell: (c) => signedMoney(c.changeCents),
            sort: (c) => c.changeCents,
            className: (c) => (c.changeCents > 0 ? "worse" : c.changeCents < 0 ? "better" : undefined),
          },
          {
            key: "cause",
            label: t("rpt.sc_cause"),
            kind: "text",
            cell: (c) => (
              <span className="muted">
                {causes(c, c.bills)}
                {c.restCount > 0 && `${c.buckets.length ? `; ${t("rpt.sc_small")}` : `${t("rpt.sc_small")[0]!.toUpperCase()}${t("rpt.sc_small").slice(1)}`} ${signedMoney(c.restCents)}`}
                {c.season && ` (${season()})`}
              </span>
            ),
          },
        ]}
        drill={(c) => (c.merchants.length > 0 ? <Merchants view={view} category={c} /> : null)}
        drillLabel={(c) => t("rpt.sc_payees", { category: c.label })}
        total={{
          label: t("rpt.total"),
          cells: { now: money(change.nowCents, false), base: money(change.baseCents, false), change: signedMoney(change.changeCents) },
        }}
      />
    </ReportPanel>
  );
}

export const section: ReportSection = {
  id: "muutos",
  get title() {
    return t("rpt.sec_spendingchange");
  },
  order: 25,
  // why last month differed: Yhteenveto, the month before the running one, in place of the month table
  page: "month",
  reports: ["spendingChange"],
  // a view needs three complete months before the month, or a year of history
  visible: (ctx) => ctx.data.spendingChange.views.length > 0,
  Component: SpendingChange,
};
