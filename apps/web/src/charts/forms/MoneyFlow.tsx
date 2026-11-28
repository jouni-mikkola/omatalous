// Decision: how much of the household's life is paid with credit or savings, and how large a cut would end it
import { sankey, sankeyLinkHorizontal } from "d3-sankey";
import { useWidth } from "../../hooks.ts";
import { css } from "../../css.ts";
import { money } from "../../format.ts";
import { t } from "../../text.ts";
import "../../styles/money-flow.css";

interface MoneyFlowBand {
  id: string;
  label: string;
  kind: "income" | "drawn" | "spending" | "debt" | "kept";
  cents: number;
}

interface FlowNode {
  id: string;
  label: string;
  kind: MoneyFlowBand["kind"] | "middle";
}

/** Under this width the picture is two stacked bars and a legend: the labels of a diagram do not fit. */
const NARROW = 560;
/** The width the first paint draws at, before the box is measured. */
const UNMEASURED = 720;
const LABEL_ROOM = 190;
const NODE_WIDTH = 14;
const NODE_GAP = 10;
const ROW_HEIGHT = 30;
/** Raises the two-line label so its middle sits on the middle of the node. */
const LABEL_LIFT = 3;
const MIN_HEIGHT = 240;
const MIDDLE = "middle";

/**
 * The sources on the left and the uses on the right, equal in total. Every band runs through one middle node and none
 * from a source to a use: money has no label, so "this pay bought that food" would be made up. The sums are the
 * report's, and the bands are drawn by size only. Under 560 px the two sides are two stacked bars with a legend.
 */
export function MoneyFlow({ sources, uses, label }: { sources: readonly MoneyFlowBand[]; uses: readonly MoneyFlowBand[]; label: string }) {
  const [ref, measured] = useWidth<HTMLDivElement>();
  const width = measured || UNMEASURED;
  return (
    <div className="money-flow" ref={ref}>
      {width < NARROW ? <Stacked sources={sources} uses={uses} label={label} /> : <Diagram sources={sources} uses={uses} label={label} width={width} />}
    </div>
  );
}

function Diagram({ sources, uses, label, width }: { sources: readonly MoneyFlowBand[]; uses: readonly MoneyFlowBand[]; label: string; width: number }) {
  const height = Math.max(MIN_HEIGHT, Math.max(sources.length, uses.length) * ROW_HEIGHT);
  const nodes: FlowNode[] = [...sources, { id: MIDDLE, label: "", kind: "middle" as const }, ...uses].map(({ id, label: name, kind }) => ({ id, label: name, kind }));
  const links = [...sources.map((b) => ({ source: b.id, target: MIDDLE, value: b.cents })), ...uses.map((b) => ({ source: MIDDLE, target: b.id, value: b.cents }))];
  const layout = sankey<FlowNode, { source: string; target: string; value: number }>()
    .nodeId((n) => n.id)
    .nodeWidth(NODE_WIDTH)
    .nodePadding(NODE_GAP)
    .nodeSort(null)
    .extent([
      [LABEL_ROOM, 4],
      [width - LABEL_ROOM, height - 4],
    ]);
  const graph = layout({ nodes: nodes.map((n) => ({ ...n })), links: links.map((l) => ({ ...l })) });
  const path = sankeyLinkHorizontal();
  const centsOf = (id: string) => [...sources, ...uses].find((b) => b.id === id)!.cents;
  return (
    <svg className="mf-svg" role="img" aria-label={label} viewBox={`0 0 ${width} ${height}`} width={width} height={height}>
      <g>
        {graph.links.map((l) => {
          const source = l.source as { id: string; kind: FlowNode["kind"] };
          const target = l.target as { id: string; kind: FlowNode["kind"] };
          const band = source.id === MIDDLE ? target : source;
          return <path key={`${source.id}>${target.id}`} className={`mf-link mf-${band.kind}`} d={path(l) ?? undefined} strokeWidth={Math.max(1, l.width ?? 0)} />;
        })}
      </g>
      <g>
        {graph.nodes.map((n) => {
          const left = n.id === MIDDLE ? false : sources.some((b) => b.id === n.id);
          const x0 = n.x0 ?? 0;
          const x1 = n.x1 ?? 0;
          const y0 = n.y0 ?? 0;
          const y1 = n.y1 ?? 0;
          return (
            <g key={n.id}>
              <rect className={`mf-node mf-${n.kind}`} x={x0} y={y0} width={x1 - x0} height={Math.max(1, y1 - y0)}>
                {n.id !== MIDDLE && <title>{`${n.label} ${money(centsOf(n.id))}`}</title>}
              </rect>
              {n.id !== MIDDLE && (
                <text className="mf-text" x={left ? x0 - 6 : x1 + 6} y={(y0 + y1) / 2 - LABEL_LIFT} textAnchor={left ? "end" : "start"}>
                  <tspan x={left ? x0 - 6 : x1 + 6}>{n.label}</tspan>
                  <tspan className="mf-sum" x={left ? x0 - 6 : x1 + 6} dy="1.2em">
                    {money(centsOf(n.id))}
                  </tspan>
                </text>
              )}
            </g>
          );
        })}
      </g>
    </svg>
  );
}

function Stacked({ sources, uses, label }: { sources: readonly MoneyFlowBand[]; uses: readonly MoneyFlowBand[]; label: string }) {
  return (
    <div className="mf-stacked" role="img" aria-label={label}>
      {[
        { name: t("rpt.mf_sources"), side: sources },
        { name: t("rpt.mf_uses"), side: uses },
      ].map(({ name, side }) => {
        const total = side.reduce((sum, b) => sum + b.cents, 0);
        return (
          <div key={name} className="mf-side">
            <p className="mf-side-name">{name}</p>
            <div className="mf-bar">
              {side.map((b) => (
                <span key={b.id} className={`mf-seg mf-${b.kind}`} ref={css({ "flex-grow": total > 0 ? b.cents / total : 0 })} />
              ))}
            </div>
            <ul className="mf-legend">
              {side.map((b) => (
                <li key={b.id}>
                  <span className={`mf-key mf-${b.kind}`} />
                  <span className="mf-name">{b.label}</span>
                  <span className="mf-sum">{money(b.cents)}</span>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
