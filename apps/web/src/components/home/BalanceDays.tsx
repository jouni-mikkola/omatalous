// Decision: on which day before the payday the money is tightest, and which bill takes it there
import { BalanceSteps, type KnownLowPoint, stepName } from "../../charts/forms/BalanceSteps.tsx";
import { dateRange, dayMonth } from "../../format.ts";
import { t } from "../../text.ts";
import { ChartWithTable } from "../table/selection.tsx";
import { type Column, Table } from "../table/Table.tsx";

interface DayRow {
  key: string;
  date: string;
  name: string;
  cents: number;
  afterCents: number;
}

/** The rows of the table in the order of the walk: the card debt, then for each step day its spending rows and its payments and pays. Core gives each its sum and the balance after it. */
function rowsOf(low: KnownLowPoint): DayRow[] {
  const rows: DayRow[] = [];
  if (low.cardDebtCents > 0 && low.steps.length > 0) rows.push({ key: "debt", date: low.line[0]!.date, name: t("home.ledger_cards"), cents: -low.cardDebtCents, afterCents: low.startCents });
  const dates = [...new Set(low.steps.map((s) => s.date))];
  for (const date of dates) {
    for (const [i, p] of low.spending.filter((p) => p.date === date).entries()) {
      const name = p.kind === "everyday" ? t("home.days_spent", { range: dateRange(p.since, p.until) }) : t("home.days_cards");
      rows.push({ key: `${date}:spent:${i}`, date: p.since, name, cents: p.cents, afterCents: p.afterCents });
    }
    for (const [i, s] of low.steps.entries()) if (s.date === date) rows.push({ key: `${date}:${i}`, date, name: stepName(s), cents: s.cents, afterCents: s.rowAfterCents });
  }
  return rows;
}

/**
 * Saldo päivä päivältä: the walk of core's `lowPoint` as a picture (BalanceSteps), with its payments and pays folded
 * under it as a table, and the spending core takes off between them as rows of their own, so the balance of each row,
 * also each of several payments of one day, is the one before it plus its sum. It stands under the sum left on the payday on a wide screen and under the month's
 * figures on a phone (home.css). Only while the lowest balance is known and the walk has a day to go.
 */
export function BalanceDays({ low, payday }: { low: KnownLowPoint; payday: string | null }) {
  const rows = rowsOf(low);
  const columns: Column<DayRow>[] = [
    { key: "day", label: t("home.days_col_day"), kind: "text", rowHead: true, cell: (r) => dayMonth(r.date) },
    { key: "payee", label: t("home.col_payee"), kind: "text", cell: (r) => r.name },
    { key: "sum", label: t("home.col_sum"), kind: "money", precision: "cents", cents: (r) => r.cents },
    { key: "after", label: t("home.days_balance"), kind: "money", main: true, precision: "cents", cents: (r) => r.afterCents },
  ];
  return (
    <section className="card home-days" aria-labelledby="home-days-h">
      <h2 id="home-days-h">{t("home.days_title")}</h2>
      <ChartWithTable
        title={t("home.days_table")}
        rows={rows.length}
        chart={<BalanceSteps low={low} payday={payday} />}
        table={rows.length > 0 ? <Table<DayRow> caption={t("home.days_title")} rows={rows} rowKey={(r) => r.key} columns={columns} toolbar={false} search={false} csv={false} /> : undefined}
      />
    </section>
  );
}
