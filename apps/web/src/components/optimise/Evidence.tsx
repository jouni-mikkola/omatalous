/** The calculation behind one finding: its lines as one line, the monthly sums as a step line with their table under it, and the rows it stands on. */
import { query } from "../../api.ts";
import { date, money } from "../../format.ts";
import { useApi } from "../../hooks.ts";
import { t } from "../../text.ts";
import type { Scope } from "../../types.ts";
import { MarkCell } from "../table/Cells.tsx";
import { Table } from "../table/Table.tsx";
import { ChartWithTable } from "../table/selection.tsx";
import { MonthSteps, MonthStepsTable } from "./MonthSteps.tsx";
import type { EvidenceResponse } from "@banking/core";

/** Rows shown before "Näytä kaikki": the newest, which is what a household checks first. */
const ROWS_SHOWN = 8;

/** What the tip measures, a month a step, the change it is about marked; the same months stand as rows under it. */
function MonthlySums({ sums, change }: Pick<EvidenceResponse, "sums" | "change">) {
  if (!sums.some((s) => s.cents !== 0)) return null;
  return (
    <div className="evidence-part">
      <div className="evidence-head">
        <h4>{t("ow.ev_monthly")}</h4>
      </div>
      <ChartWithTable chart={<MonthSteps sums={sums} change={change} label={t("ow.ev_spend")} />} table={<MonthStepsTable sums={sums} change={change} label={t("ow.ev_spend")} />} />
    </div>
  );
}

function Rows({ rows, household }: { rows: EvidenceResponse["rows"]; household: boolean }) {
  const newest = [...rows].sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
  const showAccount = household && new Set(rows.map((r) => r.accountId)).size > 1;
  type Row = EvidenceResponse["rows"][number];
  return (
    <div className="evidence-part">
      <div className="evidence-head">
        <h4>{t("ow.ev_rows")}</h4>
        {rows.some((r) => r.struck) && <span className="small muted">{t("ow.ev_struck_note")}</span>}
      </div>
      <Table<Row>
        caption={t("ow.ev_caption")}
        className="evidence-rows"
        rows={newest}
        rowKey={(r) => r.id}
        page={ROWS_SHOWN}
        rowClassName={(r) => (r.struck ? "struck" : undefined)}
        columns={[
          { key: "date", label: t("ow.ev_date"), kind: "date", className: () => "when", cell: (r) => date(r.date) },
          { key: "merchant", label: t("ow.ev_payee"), kind: "text", rowHead: true, cell: (r) => <MarkCell name={r.merchant} /> },
          ...(showAccount ? [{ key: "account", label: t("ow.ev_account"), kind: "text" as const, phone: "hide" as const, cell: (r: Row) => r.account }] : []),
          {
            key: "sum",
            label: t("ow.ev_amount"),
            kind: "money",
            main: true,
            cell: (r) => (
              <>
                {r.struck ? <s>{money(r.amountCents)}</s> : money(r.amountCents)}
                {r.struck && <span className="sr-only">{` (${t("ow.ev_not_counted")})`}</span>}
              </>
            ),
          },
        ]}
      />
    </div>
  );
}

export function Evidence({ id, scope }: { id: string; scope: Scope }) {
  const { data, error } = useApi<EvidenceResponse>(`/api/optimise/evidence${query({ id, scope })}`);
  if (error && !data) return <div className="evidence error" role="alert">{t("ow.ev_fail", { error })}</div>;
  if (!data) return <div className="evidence muted" role="status">{t("ow.ev_loading")}</div>;
  const merchants = [...new Set(data.rows.map((r) => r.merchant))].slice(0, 4);
  return (
    <div className="evidence">
      <div className="evidence-part">
        <div className="evidence-head">
          <h4>{t("ow.ev_calc")}</h4>
        </div>
        {/* the calculation is one line: each figure with its name, the struck ones taken out */}
        <dl className="calc-line">
          {data.calc.map((line, i) => (
            <div key={i} className={line.struck ? "struck" : undefined}>
              <dt>{line.label}</dt>
              <dd>{line.struck ? <s>{line.value}</s> : line.value}</dd>
            </div>
          ))}
        </dl>
      </div>
      <MonthlySums sums={data.sums} change={data.change} />
      {data.rows.length > 0 && <Rows rows={data.rows} household={scope === "household"} />}
      {merchants.length > 0 && (
        <p className="small muted evidence-check">
          {t("ow.ev_fix")}{" "}
          {merchants.map((m, i) => (
            <span key={m}>
              {i > 0 && ", "}
              <a href={`#/transactions${query({ merchant: m })}`}>{m}</a>
            </span>
          ))}
        </p>
      )}
    </div>
  );
}
