// Decision: where to cut
import { useState } from "react";
import { query } from "../../../api.ts";
import { type CategoryStat, printedParts } from "@banking/core";
import { CategoryParts } from "../../../components/CategoryParts.tsx";
import { money, monthLabel, percent, shareText, signedMoney } from "../../../format.ts";
import { addsUpPrinted } from "../../../marks.ts";
import { ExportLink, NEGATIVE_TOTAL_NOTE } from "../parts.tsx";
import { approxText, Why } from "../../../components/Why.tsx";
import { BarCell, BarFigure, DeltaChip } from "../../../components/table/Cells.tsx";
import { type Column, Table } from "../../../components/table/Table.tsx";
import { PriceParts } from "./Drift.tsx";
import type { ReportSection, SectionProps } from "../types.ts";
import { QuestionChart, ReportPanel } from "../../../charts/forms/parts.tsx";
import { SmallMultiples, type Tile } from "../../../charts/forms/SmallMultiples.tsx";

/** Tiles of the small multiples: two rows of four on a wide screen, four rows of two on a phone. */
const TILES = 8;

/** The small multiples' table view: each tile's months as a row, the months folded into a list under the name on a narrow screen. */
function TilesTable({ tiles, months }: { tiles: Tile[]; months: string[] }) {
  return (
    <Table<Tile>
      caption="Pienoiskaaviot taulukkona"
      rows={tiles}
      rowKey={(t) => t.key}
      columns={[
        { key: "name", label: "Kategoria", kind: "text", rowHead: true, cell: (t) => t.name },
        ...months.map((m, i): Column<Tile> => ({ key: m, label: monthLabel(m, m.endsWith("-01")), text: monthLabel(m, true), kind: "money", series: true, cell: (t) => money(t.values[i]!, false) })),
      ]}
    />
  );
}

/**
 * The server's like-for-like change (`changeCents`) as CE1's chip, in the euros it prints (`printedParts`): spending up is
 * bad, and a change that prints as no euro is "±0 €", level, so no cell is left blank without saying why.
 */
function Change({ cents }: { cents: number | null }) {
  if (cents === null) return null;
  return <DeltaChip delta={cents} text={signedMoney(cents)} meaning="spend" flat={99} />;
}

/** A category whose spending is mostly fixed costs (rent, loan instalments): a flat line that flattens every other tile. */
const FIXED = 0.5;

/** The months of a category's drill: each month of the strip with its sum and a bar against the highest of them. */
function Months({ months, values }: { months: string[]; values: number[] }) {
  const max = Math.max(...values, 0);
  const peak = values.lastIndexOf(max);
  return (
    <ul className="rt-months">
      {values.map((v, i) => (
        <li key={months[i]} className={i === peak && max > 0 ? "rt-peak" : undefined}>
          <span className="rt-month">{monthLabel(months[i] ?? "", i === 0 || !!months[i]?.endsWith("-01"))}</span>
          <BarCell value={v} max={max} />
          <span className="num">{money(v, false)}</span>
        </li>
      ))}
    </ul>
  );
}

/** A row's drill: its months, then what the change is set against and, when CP1 can tell, the rise's two parts. */
function Detail({ c, change, months, stripMonths }: { c: CategoryStat; change: number | null; months: number[]; stripMonths: string[] }) {
  // the period before and the change, printed so that they add up to the period's printed euros
  const [before = null, moved = null] = change === null ? [] : printedParts([c.previousCents, c.changeCents], c.comparedCents);
  return (
    <div className="cat-detail">
      <CategoryParts parts={c.parts} label={`${c.label} tuoteryhmittäin`} />
      {months.length > 0 && <Months months={stripMonths} values={months} />}
      {before !== null && moved !== null && (
        <p className="cat-base">
          Muutos {signedMoney(moved)} edelliseen yhtä pitkään jaksoon verrattuna samoilla tileillä: ennen {money(before, false)}, nyt {money(c.comparedCents, false)}.
        </p>
      )}
      {c.prices && <PriceParts split={c.prices} change={change ?? undefined} id={`kategoriat-${c.category}`} before="Edellisen jakson ostot" />}
    </div>
  );
}

/**
 * Where the money went: total, share and a usual month per category, with the months behind the row's arrow, and the change
 * against the period before, whose base and price split open from the chip. The months of the strip are the eight small
 * multiples above it. Counts and the three-month trend are in the CSV.
 */
function Categories({ ctx }: SectionProps) {
  const r = ctx.data.categories;
  const { range } = ctx;
  const [open, setOpen] = useState<string | null>(null);
  // the strip of the pivot report: the newest twelve complete months, empty under four, so a line is drawn only on enough months
  const pivot = ctx.data.pivot;
  const strip = pivot?.strip ?? [];
  const stripMonths = strip.map((i) => pivot?.months[i] ?? "");
  const rowOf = (category: string) => pivot?.rows.find((p) => p.category === category);
  const monthsOf = (category: string): number[] => {
    const row = rowOf(category);
    return row ? strip.map((i) => row.values[i] ?? 0) : [];
  };
  // a running month is no monthly figure: without a complete month in the range the column is left out
  const hasAverage = r.groups.some((g) => g.categories.some((c) => c.monthlyAvgCents !== null));
  const negative = r.groups.some((g) => g.totalCents < 0 || g.categories.some((c) => c.totalCents < 0));
  // the euros printed come from core (`printedCents`, `printedChangeCents`): every panel quotes the same figure
  const groupTotals = r.groups.map((g) => g.printedCents);
  const groupChanges = r.groups.map((g) => g.printedChangeCents);
  // the printed euros of a category's row, by its key: the answer and the tiles quote the figures the table prints
  const printedOf = new Map(r.groups.flatMap((g) => g.categories.map((c) => [c.category, { total: c.printedCents, change: c.printedChangeCents }] as const)));
  // the groups are the parts of the printed Yhteensä: the bracket stands only when the euros printed add up to it
  const sums = addsUpPrinted(groupTotals.map((t) => t ?? 0), r.totalCents);
  // the shares are core's, rounded together: the groups to 100 %, the categories of a group to the share their group prints
  const text = (units: number | null | undefined) => (units == null ? "–" : shareText(units));
  const share = (units: number | null | undefined) => <BarFigure value={units ?? 0} max={100}>{text(units)}</BarFigure>;
  // the tiles: the eight largest categories that are not fixed costs, each with its strip months; the fixed ones are
  // Kiinteät ja muuttuvat's, and on one scale with them rent would leave every other tile a sliver (critic 6)
  const stats = r.groups.flatMap((g) => g.categories).filter((c, i, a) => a.findIndex((o) => o.category === c.category) === i);
  const fixedOut = stats.filter((c) => c.fixedShare >= FIXED && c.totalCents > 0);
  const tiles: Tile[] = strip.length
    ? stats
        .filter((c) => c.fixedShare < FIXED)
        .sort((a, b) => (a.totalCents > b.totalCents ? -1 : a.totalCents < b.totalCents ? 1 : 0))
        .slice(0, TILES)
        .map((c) => ({ key: c.category, name: c.label, totalCents: printedOf.get(c.category)?.total ?? c.totalCents, changeCents: printedOf.get(c.category)?.change ?? null, values: monthsOf(c.category), averageCents: rowOf(c.category)?.averageCents ?? null }))
    : [];
  // the shared scale is the highest month of any tile: a value picked, not a sum
  const max = Math.max(0, ...tiles.flatMap((t) => t.values));
  const top = r.groups[0];
  const rose = [...stats].filter((c) => (printedOf.get(c.category)?.change ?? 0) >= 100).sort((a, b) => b.changeCents! - a.changeCents!)[0];
  const roseParts = rose?.prices ? printedParts([rose.prices.priceCents, rose.prices.quantityCents], rose.prices.changeCents, printedOf.get(rose.category)!.change!) : null;
  const answer = (
    <>
      {top && (
        <>
          Suurin menoryhmä oli {top.group.toLowerCase()}, <strong>{money(groupTotals[0]!, false)}</strong> eli {text(top.shareUnits)} menoista.
        </>
      )}
      {rose && (
        <>
          {" "}
          Menot kasvoivat eniten kategoriassa {rose.label}: <strong>{money(printedOf.get(rose.category)!.change!, false)}</strong> enemmän kuin edellisellä jaksolla samoilla tileillä.
          {roseParts && roseParts[0]! >= 100 ? ` Hintojen nousun osuus siitä on ${approxText(money(roseParts[0]!, false), true)}.` : ""}
        </>
      )}
    </>
  );
  const drillOf = (c: CategoryStat) => monthsOf(c.category).length > 0 || c.printedChangeCents !== null || c.prices !== null || !!c.parts?.length;
  const columns: Column<CategoryStat>[] = [
    {
      key: "label",
      label: "Kategoria",
      kind: "text",
      rowHead: true,
      sort: (c) => c.label,
      cell: (c) => <a href={`#/transactions${query({ category: c.category, from: range.from, to: range.to })}`}>{c.label}</a>,
    },
    {
      key: "total",
      label: "Yhteensä",
      kind: "money",
      main: true,
      sort: (c) => c.totalCents,
      cell: (c) => (
        <Why figure="spend.category" title={c.label} range={range} scope={ctx.scope} category={c.category} text={money(c.printedCents, false)}>
          {money(c.printedCents, false)}
        </Why>
      ),
    },
    { key: "share", label: "Osuus menoista", kind: "share", cell: (c) => share(c.shareUnits) },
    ...(hasAverage ? [{ key: "average", label: "Keskimäärin kuussa", kind: "money" as const, cell: (c: CategoryStat) => (c.monthlyAvgCents === null ? "–" : money(c.monthlyAvgCents, false)) }] : []),
    ...(r.comparable
      ? [
          {
            key: "change",
            label: "Muutos",
            kind: "money" as const,
            sort: (c: CategoryStat) => c.changeCents ?? 0,
            cell: (c: CategoryStat) =>
              c.printedChangeCents !== null && (
                // the chip opens the row's drill, where the change's base and its parts stand
                <button type="button" className="why-fig cat-chip" aria-expanded={open === c.category} aria-label={`${c.label}: muutos ${signedMoney(c.printedChangeCents)} edelliseen jaksoon, näytä peruste`} onClick={() => setOpen(open === c.category ? null : c.category)}>
                  <Change cents={c.printedChangeCents} />
                </button>
              ),
          } satisfies Column<CategoryStat>,
        ]
      : []),
  ];
  return (
    <ReportPanel
      id={section.id}
      title={section.title}
      datum={`Menot ${money(r.totalCents, false)}`}
      actions={<ExportLink href={ctx.exportHref("categories")} />}
    >
      {tiles.length >= 2 && (
        <>
          <QuestionChart id="kategoriat-kuukaudet" question="Miten suurimmat menot kulkevat kuukaudesta toiseen?" answer={answer} table={<TilesTable tiles={tiles} months={stripMonths} />}>
            <SmallMultiples tiles={tiles} months={stripMonths} max={max} base={r.comparable ? "Muutos on edelliseen yhtä pitkään jaksoon verrattuna samoilla tileillä." : ""} note={fixedOut.length ? `Kuvissa eivät ole kiinteät menot: ${fixedOut.slice(0, 3).map((c) => c.label).join(", ")}. Ne ovat osiossa Kiinteät ja muuttuvat.` : ""} />
          </QuestionChart>
          <hr className="qc-rule" />
        </>
      )}
      <h3 className="qc-q rt-title">Kaikki kategoriat</h3>
      {r.comparable && <p className="qc-a">Muutos on edelliseen yhtä pitkään jaksoon verrattuna samoilla tileillä.</p>}
      {r.groups.length > 0 && (
        <Table<CategoryStat>
          caption="Kaikki kategoriat"
          className="cat-table"
          rows={r.groups.flatMap((g) => g.categories)}
          rowKey={(c) => c.category}
          columns={columns}
          sums={sums ? ["total"] : undefined}
          groups={r.groups.map((g, gi) => ({
            key: g.group,
            title: (
              <>
                {g.group}
                <span className="rt-group-count">{g.categories.length}</span>
              </>
            ),
            // the group's months would be the web's sum of its categories: PD-raportit 5 asks the server for them
            cells: {
              total: money(groupTotals[gi]!, false),
              share: share(g.shareUnits),
              ...(hasAverage ? { average: g.monthlyAvgCents === null ? "–" : money(g.monthlyAvgCents, false) } : {}),
              ...(r.comparable ? { change: <Change cents={groupChanges[gi] ?? null} /> } : {}),
            },
            values: { label: g.group, total: g.totalCents, change: g.changeCents ?? 0 },
            adds: sums,
            rows: g.categories,
          }))}
          open={open}
          onOpen={setOpen}
          drill={(c) => (drillOf(c) ? <Detail c={c} change={c.printedChangeCents} months={monthsOf(c.category)} stripMonths={stripMonths} /> : null)}
          drillLabel={(c) => (c.parts?.length ? `Tuoteryhmät, kuukaudet ja muutos: ${c.label}` : `Kuukaudet ja muutos: ${c.label}`)}
          total={{
            label: "Yhteensä",
            cells: {
              total: (
                <Why figure="spend.month" title="Menot yhteensä" range={range} scope={ctx.scope} text={money(r.totalCents, false)}>
                  {money(r.totalCents, false)}
                </Why>
              ),
              share: <BarFigure value={r.totalCents ? 100 : 0} max={100}>{percent(r.totalCents ? 1 : 0)}</BarFigure>,
              ...(r.comparable ? { change: <Change cents={r.changeCents} /> } : {}),
            },
          }}
        />
      )}
      {!r.groups.length && <div className="empty">Ei menoja valitulla jaksolla.</div>}
      {negative && <p className="small muted">{NEGATIVE_TOTAL_NOTE}</p>}
    </ReportPanel>
  );
}

export const section: ReportSection = {
  id: "kategoriat",
  title: "Kategoriat",
  order: 30,
  page: "reports",
  tab: "menot",
  // the unknown share is the cash flow report's, and the months of each row the pivot's; the page asks for both anyway
  reports: ["categories", "cashflow", "pivot"],
  Component: Categories,
};
