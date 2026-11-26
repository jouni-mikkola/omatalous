import { Figure } from "./Figure.tsx";
import { type Kind, KindChip } from "./KindChip.tsx";
import "../styles/estimate.css";

/**
 * One of the three cards that tell a figure's kind, side by side on a wide screen and stacked on a phone, always in the order now, estimate, usual: the kind's chip with
 * the name of the figure beside it, the figure and the smaller figures of the same kind as rows, which share a line when they fit. The texts arrive finished from the page, and
 * so do the sums, which come from core.
 */
export function KindCard({ kind, date, label, figure, rows, link, note }: { kind: Kind; date?: string; label: string; figure: string; rows: { label: string; value: string }[]; link?: { href: string; tile: string }; note?: string }) {
  const sum = (
    <>
      <Figure text={figure} size="l" />
      {note && (
        <>
          {" "}
          <span className="kind-note">{note}</span>
        </>
      )}
    </>
  );
  return (
    <div className={`kind-card kind-${kind}`} data-kind={kind}>
      <div className="kind-top">
        <KindChip kind={kind} date={date} />
        <span className="kind-label">{label}</span>
      </div>
      <span className="kind-figure">
        {link ? (
          <a className="kind-link" data-tile={link.tile} href={link.href}>
            {sum}
          </a>
        ) : (
          sum
        )}
      </span>
      {rows.length > 0 && (
        <dl className="kind-rows">
          {rows.map((r) => (
            <div key={r.label}>
              <dt>{r.label}</dt>
              <dd>{r.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}
