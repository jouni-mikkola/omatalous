/**
 * Decision: which area to work on first: where the saving is largest, and how large against what the area costs a year.
 * One row per area with tips, in the server's order (the largest saving first), its 12 months of spending as a bar and
 * its saving as a range on a scale shared by the column. Every figure is `OptimiseData.reach`; the web only finds the
 * largest of a column for the scale.
 */
import { Estimate } from "../Why.tsx";
import type { AreaReach, AreaView } from "@banking/core";
import { money, percent } from "../../format.ts";
import { Section } from "../Section.tsx";
import { BarCell } from "../table/Cells.tsx";
import { RichTable } from "../table/RichTable.tsx";
import { AreaMark, RangeBar } from "./marks.tsx";
import { rangeText } from "./shared.tsx";

const tips = (n: number) => (n === 1 ? "1 vinkki" : `${n} vinkkiä`);

export function Reach({ reach, areas }: { reach: readonly AreaReach[]; areas: readonly AreaView[] }) {
  const label = new Map(areas.map((a) => [a.id, a.label]));
  const rows = reach.filter((r) => label.has(r.area));
  // one area is no comparison: its saving is the headline of the lead strip, said there once
  if (rows.length < 2) return null;
  const spendMax = Math.max(0, ...rows.map((r) => r.spendCents ?? 0));
  const highMax = Math.max(...rows.map((r) => r.euros.highCents));
  const first = rows[0]!;
  const firstRange = rangeText(first.euros) ?? money(first.euros.midCents, false);
  return (
    <Section
      id="alueet"
      title="Missä on eniten säästettävää?"
      sub={`${label.get(first.area)}: arviolta ${firstRange} vuodessa${first.share !== null ? `, ${percent(first.share, first.share < 0.1 ? 1 : 0)} alueen menoista` : ""}.`}
    >
      <div className="table-wrap">
        <RichTable density="comfortable" className="reach">
          <thead>
            <tr>
              <th scope="col">Alue</th>
              <th scope="col" className="num">
                Menot 12 kuukaudessa
              </th>
              <th scope="col" className="reach-range-h">
                Säästö vuodessa, arvio <span className="muted">0–{money(highMax, false)}</span>
              </th>
              <th scope="col" className="num">
                Osuus menoista
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const e = r.euros;
              const range = rangeText(e);
              return (
                <tr key={r.area}>
                  <td>
                    <a className="rt-who" href={`#alue-${r.area}`}>
                      <AreaMark id={r.area} />
                      <span className="rt-who-text">
                        <span className="reach-name">{label.get(r.area)}</span>
                        <span className="tx-under">{tips(r.count)}</span>
                      </span>
                    </a>
                  </td>
                  <td className="num reach-spend" data-head="Menot 12 kuukaudessa">
                    {r.spendCents !== null ? money(r.spendCents, false) : "–"}
                    {r.spendCents !== null && <BarCell value={r.spendCents} max={spendMax} />}
                  </td>
                  <td className="reach-range" data-head="Säästö vuodessa, arvio">
                    <RangeBar low={e.lowCents} mid={e.midCents} high={e.highCents} max={highMax} />
                    <span className="reach-range-text">
                      <Estimate when={!!range}>{money(e.midCents, false)}</Estimate>
                      {range && <span className="muted"> {range}</span>}
                    </span>
                  </td>
                  <td className="num" data-head="Osuus menoista">{r.share !== null ? percent(r.share, r.share < 0.1 ? 1 : 0) : "–"}</td>
                </tr>
              );
            })}
          </tbody>
        </RichTable>
      </div>
    </Section>
  );
}
