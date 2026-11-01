/**
 * Decision: whether the figure of a row is made of the payments the household expects, before it goes to the whole list.
 *
 * The detail of an opened row: one sentence the page wrote from the server's figures ("8 tilausta, keskimäärin 31 €"),
 * then the row's newest transactions, at most ten, and "Näytä kaikki" to Tapahtumat with the same filter when there are
 * more. The rows are the server's `/api/transactions` answer for the filter the page names; nothing is added up here.
 */
import { useApi } from "../../hooks.ts";
import { query } from "../../api.ts";
import { date } from "../../format.ts";
import { t } from "../../text.ts";
import { Button } from "../ui/Button.tsx";
import { Table } from "./Table.tsx";
import type { Column } from "./columns.ts";

/** How many rows a drill shows before the link to the whole list. */
export const DRILL_ROWS = 10;

type Row = { id: string; bookingDate: string; merchant: string; amountCents: number; partCents?: number };
type Answer = { total: number; items: Row[] };

/** A function, not a constant: the labels follow the language the member has by the time the table draws. */
const columnsOf = (): Column<Row>[] => [
  { key: "date", label: t("table.day"), kind: "date", cell: (t) => date(t.bookingDate) },
  { key: "merchant", label: t("table.payee"), kind: "text", rowHead: true, cell: (t) => t.merchant },
  { key: "amount", label: t("table.amount"), kind: "money", main: true, precision: "cents", cents: (t) => t.partCents ?? t.amountCents },
];

export type DrillRowsProps = {
  /** The filter of `/api/transactions` (category, merchant, from, to, scope); the same one `#/transactions` reads. */
  filter: Record<string, string | undefined>;
  /** The sentence over the rows. */
  summary?: string;
  /** What the rows are, for the table's name for a screen reader: "Kategoria Ruoka". */
  name: string;
};

export function DrillRows({ filter, summary, name }: DrillRowsProps) {
  const { data, error, loading } = useApi<Answer>(`/api/transactions${query({ ...filter, limit: DRILL_ROWS })}`);
  const list = `#/transactions${query({ ...filter, scope: undefined })}`;
  return (
    <div className="rt-drillrows">
      {summary && <p className="rt-drill-sum">{summary}</p>}
      {error && <p className="muted small">{t("table.drill_error", { error: error ?? "" })}</p>}
      {loading && !data && <p className="muted small">{t("table.drill_loading")}</p>}
      {data && data.items.length > 0 && <Table<Row> caption={t("table.drill_caption", { name })} rows={data.items} rowKey={(t) => t.id} columns={columnsOf()} toolbar={false} />}
      {data && data.total > data.items.length && (
        <Button variant="link" href={list}>
          {t("table.drill_all", { total: data.total })}
        </Button>
      )}
      {data && data.items.length > 0 && data.total <= data.items.length && (
        <Button variant="link" href={list}>
          {t("table.drill_open")}
        </Button>
      )}
    </div>
  );
}

