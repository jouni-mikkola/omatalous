// Decision: which yardstick to read the figure against: what is expected, the period before, a year ago or the budget
import { COMPARE_KINDS, type CompareKind, type Conclusion } from "@banking/core";
import { t } from "../../text.ts";
import { Segmented } from "../../components/ui/Segmented.tsx";

/** The words of the switch. The sentence under the figure comes from core (`FigureComparison.text`). */
const compareLabel = (kind: CompareKind): string => t(`rpt.cmp_${kind}` as "rpt.cmp_budget");

/** The comparison the page opens on, or the one the address names when the page has a figure for it. */
export function chosenKind(conclusion: Conclusion, asked: string | null): CompareKind | null {
  const named = COMPARE_KINDS.find((k) => k === asked);
  return named && conclusion.compare[named] ? named : (conclusion.verdict.comparison?.kind ?? null);
}

/** The one place a comparison is chosen. A choice with nothing to set beside is off and says why in its hint. With fewer than two choices on, there is nothing to switch and no row is drawn. */
export function Compare({ conclusion, value, onChange }: { conclusion: Conclusion; value: CompareKind | null; onChange: (kind: CompareKind) => void }) {
  if (COMPARE_KINDS.filter((k) => conclusion.compare[k]).length < 2) return null;
  return (
    <div className="compare">
      <span className="compare-label" id="compare-label">
        {t("rpt.compare")}
      </span>
      <Segmented
        label={t("rpt.compare")}
        value={value}
        onChange={onChange}
        options={COMPARE_KINDS.map((k) => ({ value: k, label: compareLabel(k), disabled: !conclusion.compare[k], hint: conclusion.gaps[k] }))}
      />
    </div>
  );
}
