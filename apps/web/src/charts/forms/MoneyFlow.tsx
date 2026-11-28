// Decision: how much of the household's life is paid with credit or savings, and how large a cut would end it
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

/**
 * The sources and the uses as two stacked bars of equal total, each with a legend that names a band and its sum on one
 * line, so no label can lie over another. Money has no label, so no band links one source to one use: the bands are
 * drawn by size only and the sums are the report's.
 */
export function MoneyFlow({ sources, uses }: { sources: readonly MoneyFlowBand[]; uses: readonly MoneyFlowBand[] }) {
  return (
    <div className="money-flow mf-stacked">
      {[
        { name: t("rpt.mf_sources"), side: sources },
        { name: t("rpt.mf_uses"), side: uses },
      ].map(({ name, side }) => {
        const total = side.reduce((sum, b) => sum + b.cents, 0);
        return (
          <div key={name} className="mf-side">
            <p className="mf-side-name">{name}</p>
            <div className="mf-bar" role="img" aria-label={`${name}: ${side.map((b) => `${b.label} ${money(b.cents)}`).join(", ")}`}>
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
