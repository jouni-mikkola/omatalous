// Decision: take on a new commitment or not, build up savings or not
import type { FixedVariableReport } from "@banking/core";
import { LAYERS, layersOf, StackedArea } from "../../../charts/forms/StackedArea.tsx";
import { QuestionChart, ReportPanel } from "../../../charts/forms/parts.tsx";
import { printedParts } from "@banking/core";
import { BarCell } from "../../../components/table/Cells.tsx";
import { DensitySwitch, RichTable, useDensity } from "../../../components/table/RichTable.tsx";
import { money, monthLong, percent } from "../../../format.ts";
import type { ReportSection, SectionProps } from "../types.ts";

/**
 * The chart's table view: the four layers of each month, the month's spending and the fixed share as a bar in the fixed
 * layer's colour, with the period's layers on the total row. All server fields; a month not ended says so.
 */
function Rows({ rows, totals, complete }: { rows: FixedVariableReport["rows"]; totals: FixedVariableReport["totals"]; complete: boolean[] }) {
  const [density, setDensity] = useDensity("fixedVariable");
  // a layer of nothing has no column, as the chart has no band for it
  const layers = layersOf(rows);
  const totalEuros = printedParts(LAYERS.map((l) => totals[l.key]), totals.spendingCents);
  return (
    <>
      <div className="rt-tools">
        <DensitySwitch density={density} onChange={setDensity} />
      </div>
      <RichTable density={density} cards className="ruled fv-table">
        <thead>
          <tr>
            <th>Kuukausi</th>
            {layers.map((l) => (
              <th key={l.key} className="num">
                <span className="fv-key" style={{ background: l.color }} aria-hidden="true" />
                {l.label}
              </th>
            ))}
            <th className="num">Menot</th>
            <th className="num" colSpan={2}>
              Kiinteiden osuus
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            // the layers of the month in euros that add up to its Menot as printed (core `printedParts`)
            const printed = printedParts(LAYERS.map((l) => r[l.key]), r.tops[3]);
            const euros = (key: (typeof LAYERS)[number]["key"]) => printed[LAYERS.findIndex((l) => l.key === key)]!;
            return (
            <tr key={r.month}>
              <td>
                {monthLong(r.month)}
                {!complete[i] && <span className="muted"> (vajaa)</span>}
              </td>
              {layers.map((l) => (
                <td key={l.key} className="num" data-label={l.label.toLowerCase()}>
                  {money(euros(l.key), false)}
                </td>
              ))}
              <td className="num fv-sum" data-rt="main">
                {money(r.tops[3], false)}
              </td>
              <td className="rt-bar-cell">{r.fixedShare !== null && <BarCell value={r.fixedShare} max={1} color={LAYERS[0].color} />}</td>
              <td className="num" data-label="kiinteiden osuus">
                {r.fixedShare === null ? "–" : percent(r.fixedShare)}
              </td>
            </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="foot-row">
            <td>Jakso yhteensä</td>
            {layers.map((l) => (
              <td key={l.key} className="num" data-label={l.label.toLowerCase()}>
                {money(totalEuros[LAYERS.findIndex((x) => x.key === l.key)]!, false)}
              </td>
            ))}
            <td className="num fv-sum" data-rt="main">
              {money(totals.spendingCents, false)}
            </td>
            <td className="rt-bar-cell">{totals.fixedShare !== null && <BarCell value={totals.fixedShare} max={1} color={LAYERS[0].color} />}</td>
            <td className="num" data-label="kiinteiden osuus">
              {totals.fixedShare === null ? "–" : percent(totals.fixedShare)}
            </td>
          </tr>
        </tfoot>
      </RichTable>
    </>
  );
}

/** "syyskuussa", or "syyskuussa 2025" with the year: the month in the inessive (every month's name ends in -kuu). */
const inMonth = (month: string, withYear = false) => {
  const [name, year] = monthLong(month).split(" ");
  return withYear ? `${name}ssa ${year}` : `${name}ssa`;
};
const capital = (s: string) => `${s[0]!.toUpperCase()}${s.slice(1)}`;

function FixedVariable({ ctx }: SectionProps) {
  const r = ctx.data.fixedVariable;
  const { buffer } = ctx.data;
  // a month counts when it has ended and the history holds it whole, as the cash flow rows tell
  const done = new Set(ctx.data.cashflow.rows?.filter((x) => x.complete).map((x) => x.month) ?? []);
  const complete = r.rows.map((x) => done.has(x.month));
  // the newest complete month against the first one the chart draws, in the server's whole percents the end labels show
  const last = r.rows.findLast((x, i) => complete[i] && x.shares[0] !== null);
  const first = r.rows.find((x, i) => complete[i] && x.shares[0] !== null);
  const months = buffer.bufferMonths === null ? null : buffer.bufferMonths.toLocaleString("fi-FI", { maximumFractionDigits: 1 });
  return (
    <ReportPanel id={section.id} title={section.title} datum={`Kiinteät ${money(buffer.fixedMonthlyCents, false)} kuussa`}>
      <QuestionChart
        id="kiinteat-osat"
        question="Kuinka suuri osa menoista on lukittu ennen kuun alkua?"
        answer={
          <>
            {last ? (
              <>
                {capital(inMonth(last.month))} kiinteisiin menoihin meni <strong>{last.shares[0]} %</strong> menoista.{" "}
                {first && first.month !== last.month ? `${capital(inMonth(first.month, true))} osuus oli ${first.shares[0]} %. ` : null}
              </>
            ) : null}
            Kiinteät menot ovat nyt <strong>{money(buffer.fixedMonthlyCents, false)}</strong> kuussa
            {buffer.fixedShare === null ? "." : `, ${percent(buffer.fixedShare)} tavallisista tuloista.`}
            {months === null ? "" : ` Tileillä olevat rahat riittävät ${months} kuukauden tavallisiin menoihin.`}
          </>
        }
        table={<Rows rows={r.rows} totals={r.totals} complete={complete} />}
      >
        <StackedArea rows={r.rows} complete={complete} />
      </QuestionChart>
    </ReportPanel>
  );
}

export const section: ReportSection = {
  id: "kiinteat",
  title: "Kiinteät ja muuttuvat",
  order: 60,
  page: "reports",
  tab: "virta",
  // the fixed costs a month and their share of the income are the buffer report's, the complete months the cash flow's
  reports: ["fixedVariable", "buffer", "cashflow"],
  Component: FixedVariable,
};
