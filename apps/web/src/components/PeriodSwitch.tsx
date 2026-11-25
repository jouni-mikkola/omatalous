import { useNavigate } from "@tanstack/react-router";
import { dateRange } from "../format.ts";
import type { PeriodPreset } from "../period.ts";
import { t } from "../text.ts";
import { Segmented } from "./ui/Segmented.tsx";

/**
 * The period switch with the dates it covers. The shell draws it above a page; Raportit draws it in the row of its tabs.
 * A choice is the address's `period`.
 */
export function PeriodSwitch({ presets, period, range }: { presets: readonly PeriodPreset[]; period: string; range: { from: string; to: string } }) {
  const navigateTo = useNavigate();
  return (
    <div className="filters" role="toolbar" aria-label={t("shell.period")}>
      <Segmented
        label={t("shell.period")}
        value={period}
        options={presets.map((p) => ({ value: p.id, label: p.label }))}
        onChange={(id) => void navigateTo({ to: ".", search: (prev: Record<string, string | undefined>) => ({ ...prev, period: id }), resetScroll: false })}
      />
      <span className="range-label">{dateRange(range.from, range.to)}</span>
    </div>
  );
}
