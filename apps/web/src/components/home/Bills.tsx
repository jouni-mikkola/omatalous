// Decision: which bills leave before the payday, on which days, and what they come to
import { upcomingGroups } from "@banking/core";
import { approxText } from "../../approx.ts";
import { dayMonth, money } from "../../format.ts";
import { hashOf } from "../../routes.ts";
import { t, tn } from "../../text.ts";
import type { DashboardData } from "../../types.ts";
import { isEstimate, isPayment, windowPayday } from "../next-days.ts";
import { Table } from "../table/Table.tsx";
import { Button } from "../ui/Button.tsx";

type Data = DashboardData & { nyt: NonNullable<DashboardData["nyt"]> };
type Row = NonNullable<DashboardData["ahead"]>["rows"][number];
/** A row with its place in the list: two equal bills on one day are two rows. */
type Shown = Row & { at: number };

/** The rows the block shows; the rest are one line and the link to Laskut. */
const BILLS_SHOWN = 6;

/** Laskut at the list the block shows: the bills before the payday that the tile takes off, or its list of what is coming. */
const billsHref = (anchor: string) => hashOf({ page: "bills", params: new URLSearchParams(), anchor });

/**
 * The rows and the sum of the block, as Laskut has them: before a known payday the payments of `ahead.rows` before it
 * and `nyt.left.billsCents` (BeforePayday, which the Käytettävissä tile takes off), else the first group of
 * `upcomingGroups` with its own sum: the bills to the payday when there is one but no balance to start from, the 30
 * days when there is none. Null with no window at all.
 */
function billsOf(data: Data): { rows: Row[]; cents: number; until: string; none: string; anchor: string } | null {
  const { ahead, nyt } = data;
  if (!ahead) return null;
  const left = nyt.left;
  if (left.known && ahead.payday) {
    const rows = ahead.rows.filter(isPayment).filter((r) => r.source !== "income" && r.date < left.payday.date);
    return { rows, cents: left.billsCents, until: t("home.bills_until", { date: dayMonth(left.payday.date) }), none: t("home.bills_none"), anchor: "ennen-palkkapaivaa" };
  }
  const first = upcomingGroups(ahead)[0];
  if (!first) return null;
  const payday = first.key === "window" ? windowPayday(ahead) : null;
  const rows = first.rows.map((i) => ahead.upcoming[i]!);
  if (payday) return { rows, cents: first.cents, until: t("home.bills_until", { date: dayMonth(payday) }), none: t("home.bills_none"), anchor: "tulossa" };
  return { rows, cents: first.cents, until: t("home.bills_days"), none: t("home.bills_none_days"), anchor: "tulossa" };
}

/**
 * Tulevat laskut: the bills to the payday by date, the first six with their date, payee and sum, the rest as one line,
 * and the sum of them all, which is Laskut's own figure for the same list. The heading and the link open Laskut. Nothing
 * is added up here.
 */
export function Bills({ data }: { data: Data }) {
  const bills = billsOf(data);
  if (!bills) return null;
  const shown: Shown[] = bills.rows.slice(0, BILLS_SHOWN).map((r, at) => ({ ...r, at }));
  const more = bills.rows.length - shown.length;
  return (
    <section className="card home-bills" aria-labelledby="home-bills-h">
      <div className="home-block-head">
        <h2 id="home-bills-h">
          <a href={billsHref(bills.anchor)}>{t("home.bills_title")}</a>
        </h2>
        <span className="home-block-note">{bills.until}</span>
      </div>
      {bills.rows.length === 0 ? (
        <p className="home-detail">{bills.none}</p>
      ) : (
        <Table<Shown>
          caption={`${t("home.bills_title")}, ${bills.until}`}
          rows={shown}
          rowKey={(r) => String(r.at)}
          columns={[
            { key: "date", label: t("rpt.tm_day"), kind: "text", rowHead: true, cell: (r) => dayMonth(r.date) },
            { key: "payee", label: t("rpt.payee"), kind: "text", cell: (r) => r.name },
            { key: "sum", label: t("rpt.sum"), kind: "money", main: true, cell: (r) => approxText(money(Math.abs(r.cents!), false), isEstimate(r)) },
          ]}
          drillButton={false}
          toolbar={false}
          csv={false}
          search={false}
          total={{ label: more > 0 ? `${t("rpt.total")} (${tn(more, "home.bills_more_one", "home.bills_more_many")})` : t("rpt.total"), cells: { sum: money(bills.cents, false) } }}
        />
      )}
      <p className="home-more">
        <Button variant="link" href={billsHref(bills.anchor)}>
          {t("home.bills_all")}
        </Button>
      </p>
    </section>
  );
}
