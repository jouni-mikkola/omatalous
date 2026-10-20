// Decision: which category's months to look into, by seeing every large one move on the same scale
import { useWidth } from "../../hooks.ts";
import { money, monthLabel, monthLong, signedMoney } from "../../format.ts";
import { DeltaChip } from "../../components/table/Cells.tsx";
import { crisp } from "../draw.ts";
import { LiveReadout, ReadoutLayer, useReadout } from "../kit/Readout.tsx";
import { band } from "../kit/scale.ts";
import { moneyAxis } from "../kit/ticks.ts";

export interface Tile {
  key: string;
  name: string;
  totalCents: number;
  /** Like for like against the previous period (`CategoryStat.changeCents`); null when not comparable. */
  changeCents: number | null;
  /** The months of the strip, oldest first. */
  values: number[];
  /** The category's monthly average over complete months (`PivotRow.averageCents`). */
  averageCents: number | null;
}

const PLOT_H = 64;

/**
 * One tile per large category, every tile on the one scale `max` (a server value picked, never a sum), so a tall column
 * is a large month anywhere on the grid. The heat ladder carries the size: an ordinary month `--heat-2`, over the tile's
 * own average `--heat-3`, the peak `--heat-4` with its figure; the average is the dashed rule. A tap or the arrow keys read a month out in the tile's own sub line.
 */
function TilePlot({ tile, months, max }: { tile: Tile; months: string[]; max: number }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [at, setAt] = useReadout();
  const b = band(tile.values.length, width, 0.72);
  const y = (v: number) => PLOT_H - (Math.max(0, v) / Math.max(max, 1)) * PLOT_H;
  const peak = tile.values.reduce((p, v, i) => (v >= (tile.values[p] ?? -Infinity) ? i : p), 0);
  const label = (i: number) => `${monthLong(months[i]!)}: ${money(tile.values[i]!, false)}`;
  return (
    <>
      <div className="sm-sub" aria-hidden={at !== null ? undefined : true}>
        {at !== null ? (
          <span>{label(at)}</span>
        ) : (
          <>
            {tile.changeCents !== null && Math.abs(tile.changeCents) >= 100 && <DeltaChip delta={tile.changeCents} text={signedMoney(tile.changeCents)} meaning="spend" />}
            {tile.averageCents !== null && <span>{`ka. ${money(tile.averageCents, false)}/kk`}</span>}
          </>
        )}
      </div>
      <div className="chart" ref={ref}>
        {width > 0 && (
          <svg width={width} height={PLOT_H + 30} role="img" aria-label={`${tile.name} kuukausittain`}>
            <g transform="translate(0,14)">
            {tile.values.map((v, i) => (
              <rect
                key={months[i]}
                className={`sm-col${i === peak && v > 0 ? " sm-peak" : tile.averageCents !== null && v > tile.averageCents ? " sm-on" : ""}`}
                x={b.x(i)}
                y={y(v)}
                width={b.width}
                height={PLOT_H - y(v)}
                rx={1.5}
              />
            ))}
            {/* a peak worth a label stands over its average: a flat tile (rent) has none */}
            {tile.values[peak]! > 0 && (tile.averageCents === null || tile.values[peak]! > tile.averageCents * 1.05) && (
              // over its column, in the 14 px kept above the plot for it: the label never stands on the column it names
              <text className="sm-peak-label" x={Math.min(Math.max(b.centre(peak), 24), width - 24)} y={y(tile.values[peak]!) - 4} textAnchor="middle">
                {moneyAxis(tile.values[peak]!)}
              </text>
            )}
            {tile.averageCents !== null && <line className="avg-line" x1={0} x2={width} y1={crisp(y(tile.averageCents))} y2={crisp(y(tile.averageCents))} />}
            <line className="axis-line" x1={0} x2={width} y1={crisp(PLOT_H)} y2={crisp(PLOT_H)} />
            {months.length > 0 && (
              <>
                <text x={0} y={PLOT_H + 13}>
                  {monthLabel(months[0]!)}
                </text>
                <text x={width} y={PLOT_H + 13} textAnchor="end">
                  {monthLabel(months[months.length - 1]!)}
                </text>
              </>
            )}
            {at !== null && <rect x={b.x(at) - 1} y={0} width={b.width + 2} height={PLOT_H} fill="none" stroke="var(--accent)" strokeWidth={1} pointerEvents="none" />}
            <ReadoutLayer xs={tile.values.map((_, i) => b.centre(i))} innerW={width} innerH={PLOT_H} at={at} onAt={setAt} crosshair={false} label={`${tile.name}: kuukaudet. Nuolinäppäimillä siirryt kuukaudesta toiseen.`} />
            </g>
          </svg>
        )}
        <LiveReadout text={at === null ? "" : label(at)} />
      </div>
    </>
  );
}

/** `base` names what the tiles' changes are set against, said once under the grid. */
export function SmallMultiples({ tiles, months, max, note, base = "" }: { tiles: Tile[]; months: string[]; max: number; note: string; base?: string }) {
  return (
    <>
      <div className="sm-grid">
        {tiles.map((t) => (
          <div key={t.key} className="sm-tile">
            <div className="sm-head">
              <span className="sm-name" title={t.name}>
                {t.name}
              </span>
              <span className="sm-fig">{money(t.totalCents, false)}</span>
            </div>
            <TilePlot tile={t} months={months} max={max} />
          </div>
        ))}
      </div>
      <p className="sm-scale">{`Kaikilla sama asteikko, korkein pylväs ${moneyAxis(max)}. Katkoviiva on kategorian kuukausikeskiarvo.${base ? ` ${base}` : ""}${note ? ` ${note}` : ""}`}</p>
    </>
  );
}
