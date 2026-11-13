// Decision: how the household's money stands this month, at a glance: what is left to payday, what went, what came and what it has net
import { MIN_COMPARE_MONTHS } from "@banking/core";
import { hashOf } from "../../routes.ts";
import { answerMoney, completeMonths, dayMonth } from "../../format.ts";
import { figureName, t } from "../../text.ts";
import type { DashboardData, Scope } from "../../types.ts";
import { netLabelOf } from "../net-label.ts";
import { Figure } from "../Figure.tsx";
import { Why } from "../Why.tsx";

type Data = DashboardData & { nyt: NonNullable<DashboardData["nyt"]> };

/** One tile: a label, one figure and one line that compares it, the whole of it a link to the rows behind the figure. */
export interface Tile {
  id: string;
  label: string;
  /** null: the figure is not known, the line says why. */
  cents: number | null;
  line: string | null;
  /** Where the tile leads: a page, or the rows of a figure in the Miksi? panel when no list holds the figure as it is. */
  href: string | null;
  why?: { figure: "ahead.free" | "spend.month" | "income.earned"; range: { from: string; to: string } };
  /** The figure is a problem (less left than the bills take). */
  short?: boolean;
}

/** A page of Raportit by its question (`?q=`); without one, Kuukausi, which the tab opens. */
export const reportHref = (q?: string) => hashOf({ page: "reports", params: new URLSearchParams(q ? { q } : {}) });

/** Why there is no sum left to the payday, in a tile's words. */
function leftUnknown(left: Extract<Data["nyt"]["left"], { known: false }>): string {
  if (left.reason === "late") return t("home.tile_late");
  if (left.reason === "no-balance") return t("home.tile_no_balance");
  return t("home.tile_no_payday");
}

/** The month's spending against its usual level to the same day, else last month's to the same day, else why neither is shown. */
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
  if (data.home.paceGap === "cards") return t("home.tile_gap_cards");
  if (data.home.paceGap === "history") return t("home.tile_gap_history", { months: completeMonths(MIN_COMPARE_MONTHS) });
  return null;
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
 * day, the month's spending (`home.pace`, else `nyt.pace`) against the usual to the same day, the month's earned
 * income against the usual month's (`overview.income`), and what the household has net (`holdings.netCents`) with its
 * change in a month (`overview.net`).
 */
function tilesOf(data: Data): Tile[] {
  const { nyt, home, overview, holdings } = data;
  const { left } = nyt;
  const month = data.pace.month;
  return [
    {
      id: "left",
      label: t("home.tile_left"),
      cents: left.known ? left.leftCents : null,
      // on the payday the sum a day is the whole sum, so the line says only that the payday is today
      line: !left.known ? leftUnknown(left) : left.days === 0 ? t("home.tile_left_today") : t("home.tile_left_line", { sum: answerMoney(left.perDayCents), date: dayMonth(left.payday.date) }),
      href: hashOf({ page: "bills", params: new URLSearchParams(), anchor: "ennen-palkkapaivaa" }),
      // the panel lists the balances the sum starts from and each payment taken off them, which Laskut does not add up
      ...(left.known && data.ahead ? { why: { figure: "ahead.free" as const, range: { from: data.ahead.from, to: data.ahead.to } } } : {}),
      short: left.known && left.leftCents < 0,
    },
    {
      id: "spent",
      label: t("home.tile_spent"),
      cents: home.pace?.spentCents ?? nyt.pace.spentCents,
      line: spentLine(data),
      // Tapahtumat's money out takes in more than spending: the panel lists the rows of the figure itself
      href: null,
      why: { figure: "spend.month", range: { from: `${month}-01`, to: nyt.from } },
    },
    {
      id: "income",
      label: t("home.tile_income"),
      cents: overview.income.cents,
      line: overview.income.usualCents !== null ? t("home.tile_income_usual", { sum: answerMoney(overview.income.usualCents) }) : t("home.tile_gap_history", { months: completeMonths(MIN_COMPARE_MONTHS) }),
      // the earned income has no list of its own (Tapahtumat's income takes in refunds too): its panel lists its rows
      href: null,
      why: { figure: "income.earned", range: { from: `${month}-01`, to: nyt.from } },
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
export function Tiles({ data, scope }: { data: Data; scope: Scope }) {
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
            </>
          );
          const className = `home-tile${tile.short ? " home-short" : ""}`;
          return (
            <li key={tile.id} data-tile={tile.id}>
              {tile.why ? (
                // the button's name holds every word it shows, the line under the figure too
                <Why figure={tile.why.figure} title={tile.label} range={tile.why.range} scope={scope} text={tile.line ? `${figure} ${tile.line}` : figure} className={className}>
                  {inner}
                </Why>
              ) : (
                <a className={className} href={tile.href ?? undefined}>
                  {inner}
                </a>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
