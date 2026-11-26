// Decision: which payments and which expected spending take the money in the accounts to the sum left on the payday
import { paydayParts } from "@banking/core";
import type { ReactNode } from "react";
import { stepName } from "../../charts/forms/BalanceSteps.tsx";
import { dateRange, rowMoney } from "../../format.ts";
import { t } from "../../text.ts";
import type { DashboardData } from "../../types.ts";
import { Estimate } from "../Estimate.tsx";
import { KindChip } from "../KindChip.tsx";
import { type Column, Table } from "../table/Table.tsx";
import "../../styles/home.css";

export type Runway = Extract<NonNullable<DashboardData["home"]["runway"]>["leftOnPayday"], { known: true }>;
type Low = Extract<NonNullable<DashboardData["home"]["lowPoint"]>, { known: true }>;

interface Part {
  key: string;
  name: string;
  state: ReactNode;
  cents: number;
}

/**
 * The rows of the breakdown, from the accounts today to the figure: the card debt that no bill holds, each payment before the
 * payday (known or an estimate) and the spending core takes off between them. Null when the rows do not add up to the figure to the cent (core's `paydayParts`).
 */
function partsOf(low: Low, runway: Runway): Part[] | null {
  const found = paydayParts(low, runway.payday.date, runway.leftCents);
  if (!found) return null;
  const rows: Part[] = [{ key: "balance", name: t("home.ledger_balance"), state: <KindChip kind="now" />, cents: found.balanceCents }];
  if (low.cardDebtCents > 0) rows.push({ key: "debt", name: t("home.ledger_cards"), state: null, cents: -low.cardDebtCents });
  const dates = [...new Set([...found.steps, ...found.spending].map((r) => r.date))].sort();
  for (const date of dates) {
    for (const [i, p] of found.spending.filter((p) => p.date === date).entries()) {
      rows.push({ key: `${date}:spent:${i}`, name: p.kind === "everyday" ? t("home.days_spent", { range: dateRange(p.since, p.until) }) : t("home.days_cards"), state: <Estimate mark="line">{t("kind.estimate")}</Estimate>, cents: p.cents });
    }
    for (const [i, s] of found.steps.entries()) {
      if (s.date === date) rows.push({ key: `${date}:${i}`, name: stepName(s), state: s.estimate ? <Estimate mark="line">{t("bills.status_estimate")}</Estimate> : t("bills.status_known"), cents: s.cents });
    }
  }
  return rows;
}

/**
 * "Mistä luku koostuu": the walk of core's `lowPoint` to the payday as rows that add up, to the cent, from the accounts of the
 * Nyt card to the figure of the Arvio card, which is the total. Folded: the page is held to its height. When the walk is not known or its
 * rows do not make the figure it shows `otherwise`, the page's ledger. The page loads this module on its own, so the first page does not carry the table.
 */
export function Breakdown({ low, runway, otherwise }: { low: NonNullable<DashboardData["home"]["lowPoint"]>; runway: Runway; otherwise: ReactNode }) {
  const rows = low.known ? partsOf(low, runway) : null;
  if (!rows) return <>{otherwise}</>;
  const columns: Column<Part>[] = [
    { key: "name", label: t("home.col_payee"), kind: "text", rowHead: true, cell: (r) => r.name },
    { key: "state", label: t("row.status"), kind: "text", cell: (r) => r.state },
    { key: "sum", label: t("home.col_sum"), kind: "money", main: true, precision: "cents", cents: (r) => r.cents },
  ];
  return (
    <details className="chart-fold home-breakdown">
      <summary>{t("home.breakdown")}</summary>
      <Table<Part>
        caption={t("home.breakdown")}
        rows={rows}
        rowKey={(r) => r.key}
        columns={columns}
        total={{ label: t("home.fig_runway"), cells: { state: <KindChip kind="estimate" />, sum: rowMoney(runway.leftCents) } }}
        toolbar={false}
        search={false}
        csv={false}
      />
    </details>
  );
}
