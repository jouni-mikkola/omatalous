// Decision: where to cut
import { Fragment, useState } from "react";
import { query } from "../../../api.ts";
import { type CategoryStat, printedParts } from "@banking/core";
import { CategoryParts } from "../../../components/CategoryParts.tsx";
import { money, monthLabel, percent, shareText, signedMoney } from "../../../format.ts";
import { addsUpPrinted } from "../../../marks.ts";
import { ExportLink, NEGATIVE_TOTAL_NOTE } from "../parts.tsx";
import { approxText, Why } from "../../../components/Why.tsx";
import { BarCell, DeltaChip, SortHead, SparkCell } from "../../../components/table/Cells.tsx";
import { DensitySwitch, DrillButton, RichTable, useDensity } from "../../../components/table/RichTable.tsx";
import { type Sort, sortBy, sortMessage, useSort } from "../../../components/table/sort.ts";
import { PriceParts } from "./Drift.tsx";
import type { ReportSection, SectionProps } from "../types.ts";
import { QuestionChart, ReportPanel } from "../../../charts/forms/parts.tsx";
import { SmallMultiples, type Tile } from "../../../charts/forms/SmallMultiples.tsx";

/** Tiles of the small multiples: two rows of four on a wide screen, four rows of two on a phone. */
const TILES = 8;

/** The small multiples' table view: each tile's months as a row. */
function TilesTable({ tiles, months }: { tiles: Tile[]; months: string[] }) {
  return (
    <table className="ruled">
      <thead>
        <tr>
          <th>Kategoria</th>
          {months.map((m) => (
            <th key={m} className="num">
              {monthLabel(m, m.endsWith("-01"))}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {tiles.map((t) => (
          <tr key={t.key}>
            <td>{t.name}</td>
            {t.values.map((v, i) => (
              <td key={months[i]} className="num">
                {money(v, false)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
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

type Key = "label" | "total" | "change";
const SORT_LABEL: Record<Key, string> = { label: "Kategoria", total: "Yhteensä", change: "Muutos" };

/** CE1's sortable head on the table's own sort state. */
function Head({ label, k, sort, onSort, num }: { label: string; k: Key; sort: Sort<Key>; onSort: (k: Key) => void; num?: boolean }) {
  return <SortHead label={label} dir={sort?.key === k ? sort.dir : null} numeric={num} onSort={() => onSort(k)} />;
}

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
 * Where the money went: total, share and a usual month per category, with the shape of its last twelve months as a
 * line on the table's one scale and the months behind the row's arrow, and the change against the period before, whose
 * base and price split open from the chip. Counts and the three-month trend are in the CSV.
 */
function Categories({ ctx }: SectionProps) {
  const r = ctx.data.categories;
  const { range } = ctx;
  const [density, setDensity] = useDensity("categories");
  const [sort, onSort, touched] = useSort<Key>(["label"]);
  const [open, setOpen] = useState<string | null>(null);
  const [openGroups, setOpenGroups] = useState<ReadonlySet<string>>(new Set());
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
  const bar = (units: number | null | undefined) => <td className="rt-bar-cell">{units ? <BarCell value={units} max={100} /> : null}</td>;
  // sorting keeps the groups whole: the groups by their own figure, the categories inside each by theirs
  const groups = sortBy(
    r.groups.map((g, gi) => ({ g, gi })),
    sort,
    ({ g }, k) => (k === "label" ? g.group : k === "total" ? g.totalCents : g.changeCents ?? 0),
  );
  const lastGroup = groups.length - 1;
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
  // the table's lines share one scale too, from nothing to the highest month or usual level of any row, so a line's
  // height reads in euros from row to row and a small category stays low
  const scale = { lo: 0, hi: Math.max(0, ...stats.flatMap((c) => [...monthsOf(c.category), rowOf(c.category)?.averageCents ?? 0])) };
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
  const columns = 4 + (hasAverage ? 1 : 0) + (r.comparable ? 1 : 0) + 1;
  return (
    <ReportPanel
      id={section.id}
      title={section.title}
      datum={`Menot ${money(r.totalCents, false)}`}
      actions={
        <>
          <DensitySwitch density={density} onChange={setDensity} />
          <ExportLink href={ctx.exportHref("categories")} />
        </>
      }
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
        <RichTable density={density} cards live={touched ? sortMessage(SORT_LABEL[sort?.key ?? "total"], sort?.dir ?? null, sort?.key === "label") : ""} className="ruled cat-table">
          <thead>
            <tr>
              <Head label="Kategoria" k="label" sort={sort} onSort={onSort} />
              <th className="rt-spark-cell">{strip.length ? "Kuukaudet" : ""}</th>
              <Head label="Yhteensä" k="total" sort={sort} onSort={onSort} num />
              <th className="num" colSpan={2}>
                Osuus menoista
              </th>
              {hasAverage && <th className="num hide-phone">Keskimäärin kuussa</th>}
              {r.comparable && <Head label="Muutos" k="change" sort={sort} onSort={onSort} num />}
            </tr>
          </thead>
          <tbody className={sums ? "adds-up" : undefined}>
            {groups.map(({ g, gi }, at) => {
              const cats = sortBy(
                g.categories.map((c, ci) => ({ c, ci })),
                sort,
                ({ c }, k) => (k === "label" ? c.label : k === "total" ? c.totalCents : c.changeCents ?? 0),
              );
              const folded = !openGroups.has(g.group);
              return (
                <Fragment key={g.group}>
                  <tr className={`group-row${sums && at === 0 ? " part-first" : ""}${sums && at === lastGroup ? " part-last" : ""}`}>
                    <td>
                      {/* a phone opens a group by its arrow; a wide screen shows every row (critic 9) */}
                      <span className="rt-phone-only">
                        <DrillButton open={!folded} onToggle={() => setOpenGroups((s) => new Set(s.has(g.group) ? [...s].filter((x) => x !== g.group) : [...s, g.group]))} label={`Kategoriat: ${g.group}`} />
                      </span>
                      {g.group}
                      <span className="rt-group-count">{g.categories.length}</span>
                    </td>
                    {/* the group's months would be the web's sum of its categories: PD-raportit 5 asks the server for them */}
                    <td className="rt-spark-cell" />
                    <td className={`num${sums ? " sum" : ""}`} data-rt="main">
                      {money(groupTotals[gi]!, false)}
                    </td>
                    {bar(g.shareUnits)}
                    <td className="num rt-share">{text(g.shareUnits)}</td>
                    {hasAverage && <td className="num hide-phone">{g.monthlyAvgCents === null ? "–" : money(g.monthlyAvgCents, false)}</td>}
                    {r.comparable && (
                      <td className="num rt-change">
                        <Change cents={groupChanges[gi] ?? null} />
                      </td>
                    )}
                  </tr>
                  {cats.map(({ c, ci }) => {
                    const months = monthsOf(c.category);
                    const usual = rowOf(c.category)?.averageCents ?? null;
                    const total = c.printedCents;
                    const change = c.printedChangeCents;
                    const drill = months.length > 0 || change !== null || c.prices !== null || !!c.parts?.length;
                    const isOpen = open === c.category;
                    const toggle = () => setOpen(isOpen ? null : c.category);
                    return (
                      <Fragment key={c.category}>
                        <tr className={folded ? "rt-folded" : undefined}>
                          <td className={drill ? "cat-name" : "cat-name cat-flat"}>
                            {drill && <DrillButton open={isOpen} onToggle={toggle} label={c.parts?.length ? `Tuoteryhmät, kuukaudet ja muutos: ${c.label}` : `Kuukaudet ja muutos: ${c.label}`} />}
                            <a href={`#/transactions${query({ category: c.category, from: range.from, to: range.to })}`}>{c.label}</a>
                          </td>
                          <td className="rt-spark-cell">
                            {months.length >= 3 && <SparkCell values={months} usual={usual} scale={scale} label={`${c.label}: ${months.length} kuukautta, viimeisin ${money(months[months.length - 1]!, false)}${usual === null ? "" : `, keskimäärin ${money(usual, false)}`}`} />}
                          </td>
                          <td className={`num${sums ? " sum-pad" : ""}`} data-rt="main">
                            <Why figure="spend.category" title={c.label} range={range} scope={ctx.scope} category={c.category} text={money(total, false)}>
                              {money(total, false)}
                            </Why>
                          </td>
                          {bar(c.shareUnits)}
                          <td className="num rt-share">{text(c.shareUnits)}</td>
                          {hasAverage && <td className="num hide-phone">{c.monthlyAvgCents === null ? "–" : money(c.monthlyAvgCents, false)}</td>}
                          {r.comparable && (
                            <td className="num rt-change">
                              {change !== null && (
                                // the chip opens the row's drill, where the change's base and its parts stand
                                <button type="button" className="why-fig cat-chip" aria-expanded={isOpen} aria-label={`${c.label}: muutos ${signedMoney(change)} edelliseen jaksoon, näytä peruste`} onClick={toggle}>
                                  <Change cents={change} />
                                </button>
                              )}
                            </td>
                          )}
                        </tr>
                        {isOpen && (
                          <tr className="rt-detail">
                            <td colSpan={columns}>
                              <Detail c={c} change={change} months={months} stripMonths={stripMonths} />
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </Fragment>
              );
            })}
          </tbody>
          {r.groups.length > 0 && (
            <tfoot>
              <tr className="foot-row">
                <td>Yhteensä</td>
                <td className="rt-spark-cell" />
                <td className={`num${sums ? " sum-pad" : ""}`} data-rt="main">
                  <Why figure="spend.month" title="Menot yhteensä" range={range} scope={ctx.scope} text={money(r.totalCents, false)}>
                    {money(r.totalCents, false)}
                  </Why>
                </td>
                {bar(r.totalCents ? 100 : 0)}
                <td className="num">{percent(r.totalCents ? 1 : 0)}</td>
                {hasAverage && <td className="num hide-phone" />}
                {r.comparable && (
                  <td className="num rt-change">
                    <Change cents={r.changeCents} />
                  </td>
                )}
              </tr>
            </tfoot>
          )}
        </RichTable>
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
