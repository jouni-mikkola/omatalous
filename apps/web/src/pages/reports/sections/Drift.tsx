// Decision: find why a category rose and cap it
import { type DriftItem, monthEnd, printedEuros, printedParts } from "@banking/core";
import { useState } from "react";
import { query } from "../../../api.ts";
import { crisp } from "../../../charts/draw.ts";
import { QuestionChart, ReportPanel } from "../../../charts/forms/parts.tsx";
import { SparkCell } from "../../../components/table/Cells.tsx";
import { Estimate } from "../../../components/Why.tsx";
import { type Column, Table } from "../../../components/table/Table.tsx";
import { date, money, monthLong, MONTHS_SHORT, percent, signedMoney } from "../../../format.ts";
import { useWidth } from "../../../hooks.ts";
import type { ReportSection, SectionProps } from "../types.ts";

/** ["2026-07", "2026-08", "2026-09"] → "heinä–syyskuu 2026"; one month is its own name. */
function monthSpan(months: readonly string[]): string {
  const first = months[0]!;
  const last = months[months.length - 1]!;
  if (first === last) return monthLong(first);
  const name = (m: string) => MONTHS_SHORT[Number(m.slice(5, 7)) - 1]!;
  return first.slice(0, 4) === last.slice(0, 4) ? `${name(first)}–${name(last)}kuu ${last.slice(0, 4)}` : `${name(first)}kuu ${first.slice(0, 4)}–${name(last)}kuu ${last.slice(0, 4)}`;
}

/** CP1's split of a rise: the part prices explain and the part bought more, each with its basis. */
export type PriceSplit = NonNullable<DriftItem["prices"]>;
type PricePart = "price" | "quantity";

/** The rise and its two parts as printed: the parts rounded together so their euros add up to the rise's. */
interface Printed {
  change: number;
  price: number;
  quantity: number;
}

/** `change` is the rise as its row prints it (rounded with its group), by default the rise's own nearest euro. */
function printedSplit(split: PriceSplit, change = printedEuros(split.changeCents)): Printed {
  const [price, quantity] = printedParts([split.priceCents, split.quantityCents], split.changeCents, change);
  return { change, price: price!, quantity: quantity! };
}

const points = (v: number) => v.toLocaleString("fi-FI", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/**
 * What a part of the rise rests on: the index class, the months set against each other, their index points and the
 * source. `before` names the spending the prices were applied to ("Edellisen jakson ostot").
 */
function PriceBasis({ split, printed, part, id, before }: { split: PriceSplit; printed: Printed; part: PricePart; id: string; before: string }) {
  const rose = split.priceChange >= 0;
  return (
    <div className="price-basis" id={id}>
      {part === "price" ? (
        <p>
          {before} maksaisivat nyt {money(Math.abs(printed.price), false)} {printed.price >= 0 ? "enemmän" : "vähemmän"}: hinnat {rose ? "nousivat" : "laskivat"} {percent(Math.abs(split.priceChange), 1)}.
        </p>
      ) : (
        <p>
          {printed.quantity >= 0 ? "Loput noususta: ostettiin enemmän tai kalliimpia tuotteita." : "Hinnat nousivat enemmän kuin menot. Ostettiin vähemmän tai halvempia tuotteita."} Nousu {signedMoney(printed.change)}, josta hintojen osuus {signedMoney(printed.price)}.
        </p>
      )}
      <p>
        Kuluttajahintaindeksi (2025=100), hyödykeryhmä {split.coicop} {split.className}: ennen {points(split.baseIndex)} ({monthSpan(split.baseMonths)}), nyt {points(split.currentIndex)} ({monthSpan(split.currentMonths)}).
      </p>
      <p className="price-source">
        Lähde:{" "}
        <a href={split.source.url} target="_blank" rel="noreferrer">
          Tilastokeskus
        </a>
        , kuluttajahintaindeksi, tarkistettu {date(split.verifiedAt)}.
      </p>
    </div>
  );
}

/** One part as the figure that opens its basis: an estimate, so it wears the one mark of an estimate, "≈" (VT5's `Estimate`). */
function PriceFig({ cents, part, open, onToggle, basis }: { cents: number; part: PricePart; open: boolean; onToggle: () => void; basis: string }) {
  const name = part === "price" ? "hinnat" : "määrä";
  return (
    <button type="button" className="why-fig price-fig" aria-expanded={open} aria-controls={open ? basis : undefined} aria-label={`${name}: arvio ${signedMoney(cents)}, näytä peruste`} onClick={onToggle}>
      <Estimate>{signedMoney(cents)}</Estimate>
    </button>
  );
}

/**
 * "Nousu +120 €: hinnat ≈ +30 €, määrä ≈ +90 €", each part opening its basis in place under the line. `change` is the
 * rise as its row prints it, so the parts add up to the figure beside them.
 */
export function PriceParts({ split, id, before, change }: { split: PriceSplit; id: string; before: string; change?: number }) {
  const [open, setOpen] = useState<PricePart | null>(null);
  const toggle = (p: PricePart) => setOpen((o) => (o === p ? null : p));
  const basis = `${id}-peruste`;
  const printed = printedSplit(split, change);
  return (
    <div className="price-parts">
      <p className="price-line">
        Nousu {signedMoney(printed.change)}: <span className="price-name">hinnat</span> <PriceFig cents={printed.price} part="price" open={open === "price"} onToggle={() => toggle("price")} basis={basis} />, <span className="price-name">määrä</span>{" "}
        <PriceFig cents={printed.quantity} part="quantity" open={open === "quantity"} onToggle={() => toggle("quantity")} basis={basis} />
      </p>
      {open && <PriceBasis split={split} printed={printed} part={open} id={basis} before={before} />}
    </div>
  );
}

const PLOT_H = 56;

/**
 * One item: its usual level as a dashed rule over the whole tile and the recent months as columns at the right on the
 * item's own scale. The step from the usual to the new level is marked where the recent months begin, and the new
 * level runs over their columns. The extra a year is the figure; the rise's parts stand under the plot.
 */
function DriftTile({ item, label, href }: { item: DriftItem; label: string; href: string }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const max = Math.max(item.usualCents, item.recentCents, ...item.monthlyCents, 1);
  const y = (v: number) => PLOT_H - (Math.max(0, v) / max) * PLOT_H;
  const n = item.monthlyCents.length;
  // the recent months fill the right half; the left half is the time before, which the usual level stands for
  const start = width / 2;
  const step = n ? (width - start) / n : 0;
  return (
    <div className="sm-tile drift-tile">
      <div className="sm-head">
        <a className="sm-name" href={href} title={label}>
          {label}
        </a>
        <span className="sm-fig">{signedMoney(item.extraYearlyCents)}</span>
      </div>
      <div className="sm-sub">{`vuodessa, nyt ${money(item.recentCents, false)} kuussa, ennen ${money(item.usualCents, false)}`}</div>
      <div className="chart" ref={ref}>
        {width > 0 && (
          <svg width={width} height={PLOT_H + 16} role="img" aria-label={`${label}: ${item.months.map((m, i) => `${monthLong(m)} ${money(item.monthlyCents[i]!, false)}`).join(", ")}, tavallisesti ${money(item.usualCents, false)}`}>
            <line className="avg-line" x1={0} x2={start} y1={crisp(y(item.usualCents))} y2={crisp(y(item.usualCents))} />
            <text className="kit-ref-label" x={4} y={y(item.usualCents) - 4}>
              ennen
            </text>
            {item.monthlyCents.map((v, i) => (
              <rect key={item.months[i]} className="sm-col" x={start + i * step + step * 0.15} y={y(v)} width={step * 0.7} height={PLOT_H - y(v)} rx={1.5} />
            ))}
            {/* the step: from the usual level up to the new one where the recent months begin, then the new level over them */}
            <path className="drift-step" d={`M${start - 8},${crisp(y(item.usualCents))}H${crisp(start)}V${crisp(y(item.recentCents))}H${width}`} />
            <line className="axis-line" x1={0} x2={width} y1={crisp(PLOT_H)} y2={crisp(PLOT_H)} />
            {item.months.map((m, i) => (
              <text key={m} x={start + i * step + step / 2} y={PLOT_H + 13} textAnchor="middle">
                {MONTHS_SHORT[Number(m.slice(5, 7)) - 1]}
              </text>
            ))}
          </svg>
        )}
      </div>
      {item.prices && <PriceParts split={item.prices} id={`nousseet-${item.category}`} before="Tavallisen kuukauden ostot" />}
    </div>
  );
}

/**
 * The tiles' table view: each item's months as a line against its usual level, on the row's own scale as the tiles have
 * (three months on a scale from nothing would be a flat line at the top), the levels, the rise's parts and the year.
 */
function DriftTable({ items, label }: { items: DriftItem[]; label: (c: string) => string }) {
  const [open, setOpen] = useState<{ category: string; part: PricePart } | null>(null);
  const prices = items.some((i) => i.prices);
  const fig = (i: DriftItem, part: PricePart) => {
    if (!i.prices) return null;
    const on = open?.category === i.category && open.part === part;
    const printed = printedSplit(i.prices);
    return <PriceFig cents={part === "price" ? printed.price : printed.quantity} part={part} open={on} onToggle={() => setOpen(on ? null : { category: i.category, part })} basis={`nousseet-taulu-${i.category}`} />;
  };
  const columns: Column<DriftItem>[] = [
    { key: "category", label: "Kategoria", kind: "text", rowHead: true, cell: (i) => label(i.category) },
    {
      key: "months",
      label: "Kuukaudet",
      kind: "text",
      phone: "hide",
      cell: (i) => <SparkCell values={i.monthlyCents} usual={i.usualCents} label={`${label(i.category)}: ${i.months.map((m, k) => `${monthLong(m)} ${money(i.monthlyCents[k]!, false)}`).join(", ")}, ennen ${money(i.usualCents, false)}`} />,
    },
    { key: "before", label: "Ennen kuussa", kind: "money", cell: (i) => money(i.usualCents, false) },
    { key: "now", label: "Nyt kuussa", kind: "money", cell: (i) => money(i.recentCents, false) },
    ...(prices
      ? [
          { key: "price", label: "Hinnat", kind: "money" as const, cell: (i: DriftItem) => fig(i, "price") },
          { key: "quantity", label: "Määrä", kind: "money" as const, cell: (i: DriftItem) => fig(i, "quantity") },
        ]
      : []),
    { key: "year", label: "Vuodessa", kind: "money", main: true, cell: (i) => signedMoney(i.extraYearlyCents) },
  ];
  return (
    <Table<DriftItem>
      caption="Nousseet menot taulukkona"
      className="drift-table"
      rows={items}
      rowKey={(i) => i.category}
      columns={columns}
      open={open?.category ?? null}
      onOpen={() => setOpen(null)}
      drillButton={false}
      drill={(i) => (open?.category === i.category && i.prices ? <PriceBasis split={i.prices} printed={printedSplit(i.prices)} part={open.part} id={`nousseet-taulu-${i.category}`} before="Tavallisen kuukauden ostot" /> : null)}
    />
  );
}

/** Categories that sat above their own level for three months. The card is only shown when there are some (`visible`). */
function Drift({ ctx }: SectionProps) {
  const r = ctx.data.drift;
  const top = r.items[0];
  const priced = r.items.some((i) => i.prices);
  return (
    <ReportPanel id={section.id} title={section.title} datum={monthSpan(r.months)}>
      <QuestionChart
        id="nousseet-tasot"
        question="Mitkä menot ovat jääneet tavallista suuremmiksi?"
        answer={
          <>
            {r.advice}
            {top ? ` Ennen tarkoittaa ${r.baseMonths} edeltävän kuukauden mediaania, nyt kolmen viimeisen kuukauden mediaania.` : ""}
            {priced ? " Nousu on jaettu hintoihin ja määrään Tilastokeskuksen kuluttajahintaindeksin mukaan." : ""}
          </>
        }
        table={<DriftTable items={r.items} label={ctx.label} />}
      >
        <div className="sm-grid">
          {r.items.map((i) => (
            <DriftTile key={i.category} item={i} label={ctx.label(i.category)} href={`#/transactions${query({ category: i.category, from: `${i.months[0]}-01`, to: monthEnd(i.months[i.months.length - 1]!) })}`} />
          ))}
        </div>
      </QuestionChart>
    </ReportPanel>
  );
}

export const section: ReportSection = {
  id: "nousseet",
  title: "Nousseet menot",
  order: 40,
  page: "reports",
  tab: "menot",
  reports: ["drift"],
  // a card that only says nothing rose supports no decision
  visible: (ctx) => ctx.data.drift.items.length > 0,
  Component: Drift,
};
