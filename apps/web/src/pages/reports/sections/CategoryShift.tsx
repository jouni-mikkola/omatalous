// Decision: which categories moved since the period before, and whether the move is worth a look
import { QuestionChart, ReportPanel } from "../../../charts/forms/parts.tsx";
import {
  type Column,
  Table,
} from "../../../components/table/Table.tsx";
import { money, signedMoney } from "../../../format.ts";
import type { ReportSection, SectionProps } from "../types.ts";

/** The rows: the categories that moved most, ranked by the size of the move. */
const SHOWN = 8;

interface ShiftItem {
  key: string;
  label: string;
  /** Before, now and the change between them, all from the server (`changeCents`, like for like). */
  from: number;
  to: number;
  change: number;
  /** `change` as the euros Kategoriat prints (core `printedChangeCents`). */
  shown: number;
}

function itemsOf(r: SectionProps["ctx"]["data"]["categories"]): ShiftItem[] {
  // a category may stand in two groups: one line for it, from its first group
  const seen = new Set<string>();
  // ranked by the size of the move, not of the category: the rent that stayed the same would flatten every other line
  const movers = r.groups
    .flatMap((g) => g.categories)
    .filter(
      (c) =>
        c.changeCents !== null &&
        !seen.has(c.category) &&
        seen.add(c.category) &&
        Math.abs(c.changeCents) >= 1000,
    )
    .sort((a, b) => Math.abs(b.changeCents!) - Math.abs(a.changeCents!))
    .slice(0, SHOWN);
  return movers.map((c) => ({
    key: c.category,
    label: c.label,
    from: c.previousCents,
    to: c.comparedCents,
    change: c.changeCents!,
    shown: c.printedChangeCents ?? c.changeCents!,
  }));
}

/** The answer's first sentence: the largest move, up or down (FI1's wording). */
function takeaway(items: readonly ShiftItem[]): string | null {
  const top = items[0];
  if (!top) return null;
  return `${top.label}: menot ${top.change > 0 ? "kasvoivat" : "laskivat"} eniten, ${signedMoney(top.shown)}.`;
}

/**
 * The categories ranked by their move, each change a bar from the middle (up right in `--bad`, down left in `--good`),
 * so the largest moves read first and every name is whole (critic round 3: a slope cut the names and doubled
 * Vuosivertailu's). The table view is the same rows without the bars.
 */
function ShiftTable({
  items,
  bars,
}: {
  items: readonly ShiftItem[];
  bars: boolean;
}) {
  // geometry only: each bar's length is its change's share of the widest change
  const widest = Math.max(1, ...items.map((x) => Math.abs(x.change)));
  const columns: Column<ShiftItem>[] = [
    {
      key: "label",
      label: "Kategoria",
      kind: "text",
      rowHead: true,
      cell: (x) => x.label,
    },
    {
      key: "from",
      label: "Ennen",
      kind: "money",
      phone: "hide",
      cents: (x) => x.from,
      className: () => "muted",
    },
    { key: "to", label: "Nyt", kind: "money", cents: (x) => x.to },
    ...(bars
      ? [
          {
            key: "bar",
            label: "Muutoksen suuruus",
            headHidden: true,
            kind: "text" as const,
            className: () => "shift-bar-cell",
            cell: (x: ShiftItem) => (
              <span
                className={`shift-bar ${x.change > 0 ? "up" : "down"}`}
                aria-hidden="true"
                style={{ width: `${(Math.abs(x.change) / widest) * 44}%` }}
              />
            ),
          },
        ]
      : []),
    {
      key: "change",
      label: "Muutos",
      kind: "money",
      cents: (x) => x.change,
      cell: (x) => signedMoney(x.shown),
      className: (x) => (x.change > 0 ? "worse" : "better"),
    },
  ];
  return (
    <Table
      caption="Menojen muutos kategorioittain"
      className="shift-table"
      rows={[...items]}
      rowKey={(x) => x.key}
      columns={columns}
    />
  );
}


/** The causes of the change set against the same months a year earlier: core's bars, which add up to the change. */
function CauseTable({ bars }: { bars: NonNullable<SectionProps["ctx"]["data"]["rangeChange"]>["bars"] }) {
  return (
    <Table
      caption="Mistä muutos tuli"
      rows={bars.map((b, i) => ({ ...b, i }))}
      rowKey={(b) => String(b.i)}
      columns={[
        { key: "label", label: "Kategoria", kind: "text", rowHead: true, cell: (b) => b.label },
        { key: "cause", label: "Syy", kind: "text", cell: (b) => <span className="muted">{b.cause ? `${b.cause}${b.season ? ", sama kuukausi vuotta aiemmin" : ""}` : ""}</span> },
        { key: "change", label: "Muutos", kind: "money", main: true, className: (b) => (b.cents > 0 ? "worse" : "better"), cell: (b) => signedMoney(b.cents) },
      ]}
    />
  );
}

function CategoryShift({ ctx }: SectionProps) {
  const r = ctx.data.categories;
  const causes = ctx.data.rangeChange;
  const items = itemsOf(r);
  const line = takeaway(items);
  const total =
    r.changeCents === null
      ? ""
      : ` Menoja oli ${money(r.comparedTotalCents, false)}, ${money(Math.abs(r.changeCents), false)} ${r.changeCents >= 0 ? "enemmän" : "vähemmän"} kuin edellisellä jaksolla samoilla tileillä.`;
  return (
    <ReportPanel
      id={section.id}
      title={section.title}
      datum={
        r.changeCents === null
          ? undefined
          : `Muutos ${signedMoney(r.changeCents)}`
      }
    >
      <QuestionChart
        id="siirtymat-muutos"
        question="Mitkä menot muuttuivat edellisestä jaksosta?"
        answer={`${line ?? "Kategorioiden menot pysyivät ennallaan."}${total}`}
        table={<ShiftTable items={items} bars={false} />}
      >
        {items.length > 0 && <ShiftTable items={items} bars />}
      </QuestionChart>
      {causes && causes.bars.length > 0 && (
        <QuestionChart id="siirtymat-syy" question="Mistä muutos tuli vuoden takaiseen verrattuna?" answer={causes.sentence}>
          <CauseTable bars={causes.bars} />
        </QuestionChart>
      )}
    </ReportPanel>
  );
}

export const section: ReportSection = {
  id: "siirtymat",
  title: "Mikä muuttui",
  order: 31,
  page: "reports",
  tab: "menot",
  reports: ["categories", "rangeChange"],
  // without the previous period on the same accounts there is nothing to set against
  visible: (ctx) =>
    ctx.data.categories.comparable && ctx.data.categories.groups.length > 0,
  Component: CategoryShift,
};
