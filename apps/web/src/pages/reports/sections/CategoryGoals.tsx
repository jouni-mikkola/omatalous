// Decision: which category is over the goal the household set for it this month, and what goal to set where there is none
import { type FormEvent, useState } from "react";
import type { CategoryGoalRow } from "@banking/core";
import { api, query } from "../../../api.ts";
import { eurosText, money, parseEuros } from "../../../format.ts";
import { DeltaChip } from "../../../components/table/Cells.tsx";
import { type Column, Table } from "../../../components/table/Table.tsx";
import { Button } from "../../../components/ui/Button.tsx";
import { useFolded } from "../../../components/Section.tsx";
import { Notice } from "../../../components/ui/Notice.tsx";
import { ReportPanel } from "../../../charts/forms/parts.tsx";
import type { ReportSection, SectionProps } from "../types.ts";
import { t } from "../../../text.ts";

const eur = (cents: number) => money(cents, true);

function CategoryGoals({ ctx }: SectionProps) {
  const r = ctx.data.categoryGoals;
  const folded = useFolded();
  const [editing, setEditing] = useState<CategoryGoalRow | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (call: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await call();
      setEditing(null);
      ctx.reload?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const save = (category: string, monthlyCents: number) => run(() => api("/api/category-goals", { method: "PUT", body: { category, monthlyCents } }));
  const clear = (category: string) => run(() => api("/api/category-goals", { method: "DELETE", body: { category } }));
  const open = (x: CategoryGoalRow) => {
    const cents = x.goalCents ?? x.proposedCents;
    setText(cents === null ? "" : eurosText(cents));
    setError(null);
    setEditing(x);
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const cents = parseEuros(text);
    if (!editing) return;
    if (cents === null || cents < 100) return setError(t("rpt.cg_enter"));
    void save(editing.category, cents);
  };

  const columns: Column<CategoryGoalRow>[] = [
    { key: "label", label: t("rpt.category"), kind: "text", rowHead: true, sort: (x) => x.label, cell: (x) => <a href={`#/transactions${query({ category: x.category, from: ctx.range.from, to: ctx.range.to })}`}>{x.label}</a> },
    {
      key: "goal",
      label: t("rpt.cg_goal_month"),
      kind: "money",
      precision: "cents",
      cents: (x) => x.goalCents,
      cell: (x) => (x.goalCents === null ? <span className="muted">{t("rpt.cg_none")}</span> : eur(x.goalCents)),
    },
    { key: "spent", label: t("rpt.tm_spent"), kind: "money", main: true, precision: "cents", cents: (x) => x.spentCents },
    {
      key: "delta",
      label: t("rpt.tm_gap"),
      kind: "money",
      sort: (x) => x.deltaCents ?? 0,
      csv: (x) => (x.deltaCents === null ? null : x.deltaCents / 100),
      cell: (x) => x.deltaCents !== null && <DeltaChip delta={x.deltaCents} text={`${x.deltaCents > 0 ? "+" : x.deltaCents < 0 ? "−" : ""}${eur(Math.abs(x.deltaCents))}`} meaning="spend" flat={99} />,
    },
    {
      key: "act",
      label: t("rpt.cg_goal"),
      kind: "text",
      csv: false,
      cell: (x) =>
        x.goalCents === null ? (
          <>
            {x.proposedCents !== null && (
              <Button onClick={() => void save(x.category, x.proposedCents!)} busy={busy} aria-label={t("rpt.cg_accept_aria", { amount: eur(x.proposedCents), label: x.label })}>
                {t("rpt.cg_accept", { amount: eur(x.proposedCents) })}
              </Button>
            )}{" "}
            <Button variant="link" onClick={() => open(x)}>
              {t("rpt.cg_own")}
            </Button>
          </>
        ) : (
          <>
            <Button variant="link" onClick={() => open(x)} aria-label={t("rpt.cg_change_aria", { label: x.label })}>
              {t("rpt.edit")}
            </Button>{" "}
            <Button variant="link" onClick={() => void clear(x.category)} busy={busy} aria-label={t("rpt.cg_remove_aria", { label: x.label })}>
              {t("rpt.remove")}
            </Button>
          </>
        ),
    },
  ];
  // once a goal stands the table stays open, also when the last one is removed, so it does not shut under the reader
  const [unfolded, setUnfolded] = useState(false);
  const hasGoal = r.rows.some((x) => x.goalCents !== null);
  if (hasGoal && !unfolded) setUnfolded(true);
  const body = (
    <>
      <p className="qc-a">
        {r.month === null
          ? t("rpt.cg_pick")
          : r.total
            ? t("rpt.cg_sums", { spent: eur(r.total.spentCents), goal: eur(r.total.goalCents) })
            : null}
        {r.missing.length > 0 ? ` ${t("rpt.cg_missing", { list: r.missing.join(", ").toLowerCase() })}` : ""}
      </p>
      <Table<CategoryGoalRow>
        caption={t("rpt.cg_title")}
        rows={r.rows}
        rowKey={(x) => x.category}
        columns={columns}
        total={
          r.total
            ? { label: t("rpt.cg_total"), cells: { goal: eur(r.total.goalCents), spent: eur(r.total.spentCents), delta: <DeltaChip delta={r.total.deltaCents} text={`${r.total.deltaCents > 0 ? "+" : r.total.deltaCents < 0 ? "−" : ""}${eur(Math.abs(r.total.deltaCents))}`} meaning="spend" flat={99} /> } }
            : undefined
        }
      />
      {editing && (
        <form className="form-row" aria-label={t("rpt.cg_form", { label: editing.label })} onSubmit={submit}>
          <label>
            <span className="field-label">{t("rpt.cg_field", { label: editing.label })}</span>{" "}
            <input type="text" inputMode="decimal" value={text} onChange={(e) => setText(e.target.value)} placeholder="600" autoFocus />
          </label>
          <Button variant="primary" type="submit" busy={busy}>
            {t("ui.save")}
          </Button>
          <Button onClick={() => setEditing(null)}>{t("form.cancel")}</Button>
        </form>
      )}
      {error && <Notice tone="error">{error}</Notice>}
    </>
  );
  // with no goal set the table is folded, unless the section already is: its buttons are for the one time a goal is chosen
  return (
    <ReportPanel id="kategoriatavoitteet" title={t("rpt.cg_title")} datum={r.total ? t("rpt.cg_datum", { amount: eur(r.total.goalCents) }) : undefined}>
      {hasGoal || unfolded || folded ? (
        body
      ) : (
        <details>
          <summary>{t("rpt.cg_set")}</summary>
          {body}
        </details>
      )}
    </ReportPanel>
  );
}

export const section: ReportSection = {
  id: "kategoriatavoitteet",
  get title() {
    return t("rpt.sec_categorygoals");
  },
  order: 35,
  page: "reports",
  reports: ["categoryGoals"],
  Component: CategoryGoals,
};
