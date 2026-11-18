// Decision: which bills leave before the payday, on which days, and what they come to
import { upcomingGroups } from "@banking/core";
import { approxText } from "../../approx.ts";
import { answerMoney, dayMonth, money } from "../../format.ts";
import { hashOf } from "../../routes.ts";
import { t, tn } from "../../text.ts";
import type { DashboardData } from "../../types.ts";
import { Figure } from "../Figure.tsx";
import { elsewhereLabel } from "../bills/outside.ts";
import { isEstimate, isPayment, windowPayday } from "../next-days.ts";
import { Table } from "../table/Table.tsx";
import { Button } from "../ui/Button.tsx";

type Data = DashboardData & { nyt: NonNullable<DashboardData["nyt"]> };
type Row = NonNullable<DashboardData["ahead"]>["rows"][number];
/** A row with its place in the list: two equal bills on one day are two rows. */
type Shown = Row & { at: number };

/** The rows the block shows; the rest are one line and the link to Laskut. */
const BILLS_SHOWN = 6;

/** Laskut at the table of the bills, where the bills the tile takes off and the ones coming stand by month. */
const billsHref = (anchor: string) => hashOf({ page: "bills", params: new URLSearchParams(), anchor });

/**
 * The rows and the sum of the block: before a known payday the payments of `ahead.rows` before it
 * and `nyt.left.billsCents` (which the Käytettävissä tile takes off), else the first group of
 * `upcomingGroups` with its own sum: the bills to the payday when there is one but no balance to start from, the 30
 * days when there is none. Null with no window at all.
 */
function billsOf(data: Data): { rows: Row[]; cents: number; elsewhereCents: number; elsewhere: string; until: string; none: string; anchor: string } | null {
  const { ahead, nyt } = data;
  if (!ahead) return null;
  const left = nyt.left;
  if (left.known && ahead.payday) {
    const rows = ahead.rows.filter(isPayment).filter((r) => r.source !== "income" && r.date < left.payday.date);
    const outside = ahead.outside.filter((r) => r.cents !== null && r.cents < 0 && r.date < left.payday.date);
    return { rows, cents: left.billsCents, elsewhereCents: left.elsewhereCents, elsewhere: elsewhereLabel(outside), until: t("home.bills_until", { date: dayMonth(left.payday.date) }), none: t("home.bills_none"), anchor: "laskut-taulukko" };
  }
  const first = upcomingGroups(ahead)[0];
  if (!first) return null;
  const payday = first.key === "window" ? windowPayday(ahead) : null;
  const rows = first.rows.map((i) => ahead.upcoming[i]!);
  if (payday) return { rows, cents: first.cents, elsewhereCents: 0, elsewhere: "", until: t("home.bills_until", { date: dayMonth(payday) }), none: t("home.bills_none"), anchor: "tulossa" };
  return { rows, cents: first.cents, elsewhereCents: 0, elsewhere: "", until: t("home.bills_days"), none: t("home.bills_none_days"), anchor: "tulossa" };
}

/** Why there is no sum left to the payday, in a line's words. */
function leftUnknown(left: Extract<Data["nyt"]["left"], { known: false }>): string {
  if (left.reason === "late") return t("home.tile_late");
  if (left.reason === "no-balance") return t("home.tile_no_balance");
  if (left.reason === "no-card-balance") return t("home.tile_no_card_balance");
  return t("home.tile_no_payday");
}

/**
 * What is left to the payday (`nyt.left`) with its sum a day: the one figure of the page that is a payday period and not
 * the month, so it stands with the bills it is made of. On the payday the sum a day is the whole sum, so the line says
 * only that the payday is today. With no list of bills beside it, the whole of it leads to Laskut's list of the same
 * bills (`linked`); with a list, that list's own link is the one way to Laskut.
 */
function Left({ data, linked }: { data: Data; linked: boolean }) {
  const { left } = data.nyt;
  const line = !left.known ? leftUnknown(left) : left.days === 0 ? t("home.tile_left_today") : t("home.tile_left_line", { sum: answerMoney(left.perDayCents), date: dayMonth(left.payday.date) });
  const className = `home-left${left.known && left.leftCents < 0 ? " home-short" : ""}`;
  const parts = (
    <>
      {/* the spaces keep the words apart in the text a screen reader reads; the grid draws none */}
      <span className="home-fig-label">{t("home.tile_left")}</span>{" "}
      <Figure text={left.known ? answerMoney(left.leftCents) : "–"} size="m" />{" "}
      <span className="home-fig-line">{line}</span>
    </>
  );
  return linked ? (
    <a className={className} data-tile="left" href={billsHref("laskut-taulukko")}>
      {parts}
    </a>
  ) : (
    <div className={className} data-tile="left">
      {parts}
    </div>
  );
}

/**
 * Tulevat laskut: the bills to the payday by date, the first six with their date, payee and sum, the rest as one line,
 * and the sum of them all, which is Laskut's own figure for the same list. The one link of the block opens Laskut.
 * Nothing is added up here. What falls due before the payday from accounts the balance leaves out is one line under the
 * list, the account's name and the answer's own `elsewhereCents`; with such a line an empty list does not say there are no bills.
 */
export function Bills({ data }: { data: Data }) {
  const bills = billsOf(data);
  if (!bills) {
    return (
      <section className="card home-bills" aria-label={t("home.tile_left")}>
        <Left data={data} linked />
      </section>
    );
  }
  const shown: Shown[] = bills.rows.slice(0, BILLS_SHOWN).map((r, at) => ({ ...r, at }));
  const more = bills.rows.length - shown.length;
  return (
    <section className="card home-bills" aria-labelledby="home-bills-h">
      <div className="home-block-head">
        <h2 id="home-bills-h">{t("home.bills_title")}</h2>
        <span className="home-block-note">{bills.until}</span>
      </div>
      <Left data={data} linked={false} />
      {bills.rows.length === 0 ? (
        bills.elsewhereCents === 0 && <p className="home-detail">{bills.none}</p>
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
      {bills.elsewhereCents > 0 && (
        <p className="home-detail">
          {bills.elsewhere} <span className="num">{money(bills.elsewhereCents)}</span>
        </p>
      )}
      <p className="home-more">
        <Button variant="link" href={billsHref(bills.anchor)}>
          {t("home.bills_all")}
        </Button>
      </p>
    </section>
  );
}
