/**
 * Decision: which area to work on first: where the saving is largest, and how large against what the area costs a year.
 * One row per area with tips, in the server's order (the largest saving first), its 12 months of spending as a bar and
 * its saving as a range on a scale shared by the column. Every figure is `OptimiseData.reach`; the web only finds the
 * largest of a column for the scale. An area's name narrows the tips above to that area.
 */
import { Estimate } from "../Why.tsx";
import type { AreaId, AreaReach, AreaView } from "@banking/core";
import { money, percent } from "../../format.ts";
import { t, tn } from "../../text.ts";
import { Section } from "../Section.tsx";
import { Table } from "../table/Table.tsx";
import { AreaMark, RangeBar } from "./marks.tsx";
import { rangeText } from "./shared.tsx";

const tips = (n: number) => tn(n, "ow.cnt_finding_one", "ow.cnt_finding_many");

export function Reach({ reach, areas, onPick }: { reach: readonly AreaReach[]; areas: readonly AreaView[]; onPick: (area: AreaId) => void }) {
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
      title={t("ow.rc_title")}
      sub={first.share !== null ? t("ow.rc_sub_share", { area: label.get(first.area)!, range: firstRange, share: percent(first.share, first.share < 0.1 ? 1 : 0) }) : t("ow.rc_sub", { area: label.get(first.area)!, range: firstRange })}
    >
      <Table<AreaReach>
        caption={t("ow.rc_caption")}
        className="reach"
        rows={rows}
        rowKey={(r) => r.area}
        columns={[
          {
            key: "area",
            label: t("ow.rc_area"),
            kind: "text",
            rowHead: true,
            cell: (r) => (
              <button className="rt-who reach-pick" type="button" onClick={() => onPick(r.area)}>
                <AreaMark id={r.area} />
                <span className="rt-who-text">
                  <span className="reach-name">{label.get(r.area)}</span>
                  <span className="sub">{tips(r.count)}</span>
                </span>
              </button>
            ),
          },
          {
            key: "spend",
            label: t("ow.rc_spend"),
            kind: "money",
            className: () => "reach-spend",
            cell: (r) => (r.spendCents !== null ? money(r.spendCents, false) : "–"),
            bar: { value: (r) => r.spendCents ?? 0, max: spendMax },
          },
          {
            key: "range",
            label: (
              <>
                {t("ow.ld_est")} <span className="muted">0–{money(highMax, false)}</span>
              </>
            ),
            text: t("ow.ld_est"),
            kind: "text",
            main: true,
            className: () => "reach-range",
            cell: (r) => {
              const e = r.euros;
              const range = rangeText(e);
              return (
                <>
                  <RangeBar low={e.lowCents} mid={e.midCents} high={e.highCents} max={highMax} />
                  <span className="reach-range-text">
                    <Estimate when={!!range}>{money(e.midCents, false)}</Estimate>
                    {range && <span className="muted"> {range}</span>}
                  </span>
                </>
              );
            },
          },
          { key: "share", label: t("ow.rc_share"), kind: "share", cell: (r) => (r.share !== null ? percent(r.share, r.share < 0.1 ? 1 : 0) : "–") },
        ]}
      />
    </Section>
  );
}
