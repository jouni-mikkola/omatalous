// Decision: on which day before the payday the money is tightest, and which bill takes it there
import { BalanceSteps, type KnownLowPoint, stepName } from "../../charts/forms/BalanceSteps.tsx";
import { dayMonth } from "../../format.ts";
import { t } from "../../text.ts";
import { ChartWithTable } from "../table/selection.tsx";
import { type Column, Table } from "../table/Table.tsx";

type StepRow = KnownLowPoint["steps"][number] & { key: string };

/**
 * Saldo päivä päivältä: the walk of core's `lowPoint` as a picture (BalanceSteps), with its payments and pays folded
 * under it as a table, one row to each, and the balance after its day's payments. It stands under the sum left on the
 * payday on a wide screen and under the month's figures on a phone (home.css). Only while the lowest balance is known and
 * the walk has a day to go.
 */
export function BalanceDays({ low, payday }: { low: KnownLowPoint; payday: string | null }) {
  const rows: StepRow[] = low.steps.map((s, i) => ({ ...s, key: `${s.date}:${i}` }));
  const columns: Column<StepRow>[] = [
    { key: "day", label: t("home.days_col_day"), kind: "text", rowHead: true, cell: (s) => dayMonth(s.date) },
    { key: "payee", label: t("home.col_payee"), kind: "text", cell: stepName },
    { key: "sum", label: t("home.col_sum"), kind: "money", precision: "cents", cents: (s) => s.cents },
    { key: "after", label: t("home.days_col_after"), kind: "money", main: true, precision: "cents", cents: (s) => s.afterCents },
  ];
  return (
    <section className="card home-days" aria-labelledby="home-days-h">
      <h2 id="home-days-h">{t("home.days_title")}</h2>
      <ChartWithTable
        title={t("home.days_table")}
        rows={rows.length}
        chart={<BalanceSteps low={low} payday={payday} />}
        table={rows.length > 0 ? <Table<StepRow> caption={t("home.days_title")} rows={rows} rowKey={(s) => s.key} columns={columns} toolbar={false} search={false} csv={false} /> : undefined}
      />
    </section>
  );
}
