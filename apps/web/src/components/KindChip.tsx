import { t } from "../text.ts";
import "../styles/estimate.css";

/** What a figure is: `now` has happened, `estimate` is what the app expects, `usual` is the level of earlier months (ADR 0030). */
export type Kind = "now" | "estimate" | "usual";

const WORD = { now: "kind.now", estimate: "kind.estimate", usual: "kind.usual" } as const;

/**
 * The word that names a figure's kind: a filled chip for Nyt, a dashed outline for Arvio, a plain grey word for Tavallinen.
 * The word and the shape tell the kind, so colour is not the only carrier. `date` is the day the figure is for.
 */
export function KindChip({ kind, date }: { kind: Kind; date?: string }) {
  return (
    <span className="kind-head">
      <span className={`kind-chip kind-chip-${kind}`}>{t(WORD[kind])}</span>
      {date && <span className="kind-date">{date}</span>}
    </span>
  );
}
