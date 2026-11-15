// Decision: which part of a category's spending to cut, when an add-on module tells the household's rows a level under their category
import { ReportPanel } from "../../../charts/forms/parts.tsx";
import { Estimate } from "../../../components/Why.tsx";
import { type Column, Table } from "../../../components/table/Table.tsx";
import { money, plural } from "../../../format.ts";
import type { ReportsData } from "../../../types.ts";
import { inSpan } from "../parts.tsx";
import type { ReportContext, ReportSection, SectionProps } from "../types.ts";
import { t } from "../../../text.ts";

type Stat = ReportsData["categories"]["groups"][number]["categories"][number];
type Part = NonNullable<Stat["parts"]>[number];
/** One part as a row of the table: its key names the category, since two categories can have a part of the same id. */
type Row = Part & { key: string };

const eur = (cents: number) => money(cents, true);

/** The categories the server split into parts, largest first as the report orders them. None without an add-on module. */
function splitCategories(ctx: ReportContext): Stat[] {
  return (ctx.data.categories?.groups ?? []).flatMap((g) => g.categories ?? []).filter((c) => (c.parts?.length ?? 0) > 0);
}

/**
 * The parts the server gives under each category, in its order, each its own figure: nothing is added up here, and a
 * category's figure is the report's. A part that rests on a guessed tie wears "≈".
 */
function CategoryParts({ ctx }: SectionProps) {
  const split = splitCategories(ctx);
  const columns: Column<Row>[] = [
    { key: "label", label: t("rpt.st_part"), kind: "text", rowHead: true, cell: (x) => x.label },
    { key: "amount", label: t("rpt.sum"), kind: "money", main: true, precision: "cents", cents: (x) => x.cents, cell: (x) => <Estimate when={x.estimated}>{eur(x.cents)}</Estimate> },
  ];
  const groups = split.map((c) => ({
    key: c.category,
    title: <a href={`#/transactions?category=${encodeURIComponent(c.category)}&from=${ctx.range.from}&to=${ctx.range.to}`}>{ctx.label(c.category)}</a>,
    csv: ctx.label(c.category),
    figure: eur(c.totalCents),
    rows: c.parts!.map((p) => ({ ...p, key: `${c.category}:${p.id}` })),
  }));
  return (
    <ReportPanel id={section.id} title={section.title} datum={inSpan(ctx, plural(split.length, t("rpt.u_category"), t("rpt.u_categories")))}>
      <Table<Row> caption={section.title} rows={groups.flatMap((g) => g.rows)} rowKey={(x) => x.key} columns={columns} groups={groups} />
    </ReportPanel>
  );
}

export const section: ReportSection = {
  id: "osittain",
  get title() {
    return t("rpt.sec_parts");
  },
  order: 40,
  page: "reports",
  reports: ["categories"],
  // the shared app tells no row's parts: without an add-on module there is no card and no nav link
  visible: (ctx) => splitCategories(ctx).length > 0,
  Component: CategoryParts,
};
