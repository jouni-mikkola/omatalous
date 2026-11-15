// Decision: how the household's money stands this month, at a glance: what is left to payday, what went, what came and what it has net
import { MIN_COMPARE_MONTHS } from "@banking/core";
import { hashOf } from "../../routes.ts";
import { answerMoney, completeMonths, dayMonth } from "../../format.ts";
import { figureName, t } from "../../text.ts";
import type { DashboardData } from "../../types.ts";
import { netLabelOf } from "../net-label.ts";
import { Figure } from "../Figure.tsx";

type Data = DashboardData & { nyt: NonNullable<DashboardData["nyt"]> };

/** One tile: a label, one figure and one line that compares it, the whole of it a link where a page holds the figure. */
export interface Tile {
  id: string;
  label: string;
  /** null: the figure is not known, the line says why. */
  cents: number | null;
  line: string | null;
  /** A second line for a part of the figure the app cannot prove, or null. */
  note?: string | null;
  /** Where the tile leads: a page, or null where no page holds the figure as it is. */
  href: string | null;
  /** The figure is a problem (less left than the bills take). */
  short?: boolean;
}

/** A page of Raportit by its question (`?q=`). */
export const reportHref = (q: string) => hashOf({ page: "reports", params: new URLSearchParams({ q }) });

/** Why there is no sum left to the payday, in a tile's words. */
function leftUnknown(left: Extract<Data["nyt"]["left"], { known: false }>): string {
  if (left.reason === "late") return t("home.tile_late");
  if (left.reason === "no-balance") return t("home.tile_no_balance");
  if (left.reason === "no-card-balance") return t("home.tile_no_card_balance");
  return t("home.tile_no_payday");
}

/**
 * The month's spending against its usual level to the same day, else last month's to the same day, else that the history
 * is short. A comparison that waits for a card's earlier purchases says nothing: the household cannot mend it here.
 */
function spentLine(data: Data): string | null {
  const usual = data.home.pace;
  if (usual) {
    const diff = answerMoney(Math.abs(usual.diffCents));
    if (usual.position === "above") return t("home.tile_spent_above", { sum: diff });
    if (usual.position === "below") return t("home.tile_spent_below", { sum: diff });
    return t("home.tile_spent_within", { sum: answerMoney(usual.expectedCents) });
  }
  const previous = data.pace.previous;
  // a shorter month before is read to its last day: its sum is the whole month's, and the line says so
  if (previous) return t(previous.day < data.nyt.pace.day ? "home.tile_spent_previous_whole" : "home.tile_spent_previous", { sum: answerMoney(previous.toToday) });
  if (data.home.paceGap === "history") return t("home.tile_gap_history", { months: completeMonths(MIN_COMPARE_MONTHS) });
  return null;
}

/** What the sum left to the payday holds that the app cannot prove: the debt of a card whose payer it has not seen or sees from two sides. Null when every card is proven. */
function unresolvedNote(data: Data): string | null {
  const open = data.ahead?.balance?.unresolved ?? [];
  const [first] = open;
  if (!first) return null;
  const sum = answerMoney(open.reduce((s, c) => s + c.cents, 0));
  if (open.length > 1) return t("home.tile_unresolved_many", { count: open.length, sum });
  return t(first.reason === "card_payer_unseen" ? "home.tile_unresolved_unseen" : "home.tile_unresolved_mixed", { name: first.name, sum });
}

/** The change of what the household has net since the same day a month ago; with no figure, that a balance is missing. */
function netLine(net: DashboardData["overview"]["net"], cents: number | null): string | null {
  if (cents === null) return t("home.tile_net_missing");
  if (!net) return null;
  const date = dayMonth(net.since);
  if (net.changeCents === 0) return t("home.tile_net_same", { date });
  return t(net.changeCents > 0 ? "home.tile_net_more" : "home.tile_net_less", { sum: answerMoney(Math.abs(net.changeCents)), date });
}

/**
 * The four tiles, each a field of the dashboard answer as it is: what is left to the payday (`nyt.left`) with its sum a
 * day, the month's spending (the running month of `overview.months`, the bridge's) against the usual to the same day, the month's income
 * with its earned part under it when that differs (`overview.income`), and what the household has net (`holdings.netCents`) with its
 * change in a month (`overview.net`).
 */
function tilesOf(data: Data): Tile[] {
  const { nyt, overview, holdings } = data;
  const { left } = nyt;
  return [
    {
      id: "left",
      label: t("home.tile_left"),
      cents: left.known ? left.leftCents : null,
      // on the payday the sum a day is the whole sum, so the line says only that the payday is today
      line: !left.known ? leftUnknown(left) : left.days === 0 ? t("home.tile_left_today") : t("home.tile_left_line", { sum: answerMoney(left.perDayCents), date: dayMonth(left.payday.date) }),
      href: hashOf({ page: "bills", params: new URLSearchParams(), anchor: "ennen-palkkapaivaa" }),
      note: left.known ? unresolvedNote(data) : null,
      short: left.known && left.leftCents < 0,
    },
    {
      id: "spent",
      label: t("home.tile_spent"),
      cents: overview.months.at(-1)?.spendCents ?? nyt.pace.spentCents,
      line: spentLine(data),
      // Tapahtumat's money out takes in more than spending: no list holds the figure
      href: null,
    },
    {
      id: "income",
      label: t("home.tile_income"),
      cents: overview.income.cents,
      // the usual of this figure does not exist (Tavalliset tulot is the mean of the earned part), so the line shows the earned part or nothing
      line: overview.income.earnedCents !== overview.income.cents ? t("home.tile_income_earned", { sum: answerMoney(overview.income.earnedCents) }) : null,
      // Tapahtumat's money in takes in transfers too: no list holds the figure
      href: null,
    },
    {
      id: "net",
      // a loan with no balance is a debt the figure cannot hold: the label says so, as on Tilit ja saldot
      label: netLabelOf(holdings).label ?? figureName("netWorth"),
      cents: holdings.netCents,
      line: netLine(overview.net, holdings.netCents),
      href: reportHref("saldot"),
    },
  ];
}

/** The row of tiles at the top of Yhteenveto: four on a wide screen, two by two on a phone. */
export function Tiles({ data }: { data: Data }) {
  return (
    <section aria-labelledby="home-tiles-h">
      {/* a heading the reader of a screen jumps to; the tiles say what they are, so it is not drawn */}
      <h2 id="home-tiles-h" className="sr-only">
        {t("home.tiles")}
      </h2>
      <ul className="home-tiles">
        {tilesOf(data).map((tile) => {
          const figure = tile.cents === null ? "–" : answerMoney(tile.cents);
          const inner = (
            <>
              {/* the spaces keep the words apart in the text a screen reader and the button's name read; the grid draws none */}
              <span className="home-tile-label">{tile.label}</span>{" "}
              <Figure text={figure} size="l" />
              {tile.line && <>{" "}<span className="home-tile-line">{tile.line}</span></>}
              {tile.note && <>{" "}<span className="home-tile-line">{tile.note}</span></>}
            </>
          );
          const className = `home-tile${tile.short ? " home-short" : ""}`;
          return (
            <li key={tile.id} data-tile={tile.id}>
              {tile.href ? (
                <a className={className} href={tile.href}>
                  {inner}
                </a>
              ) : (
                <div className={className}>{inner}</div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
