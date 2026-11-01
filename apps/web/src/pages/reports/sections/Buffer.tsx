// Decision: whether the cash left after card debt and the bills before payday carries the household, or the debt comes first
import { ReportPanel } from "../../../charts/forms/parts.tsx";
import { KeyValue } from "../../../components/table/KeyValue.tsx";
import { decimal, money } from "../../../format.ts";
import type { ReportSection, SectionProps } from "../types.ts";
import { rich, t } from "../../../text.ts";

interface Line {
  label: string;
  cents: number;
}

/** The buffer as the calculation it is: what the accounts hold, what is already spoken for and what is left. */
function CashBuffer({ ctx }: SectionProps) {
  const b = ctx.data.buffer;
  if (b.cashCents === null || b.netCents === null) return null;
  const lines: Line[] = [
    { label: t("rpt.buf_cash"), cents: b.cashCents },
    ...(b.cardDebtCents > 0 ? [{ label: t("rpt.buf_cards"), cents: -b.cardDebtCents }] : []),
    ...(b.dueBeforePaydayCents > 0 ? [{ label: t("rpt.buf_due"), cents: -b.dueBeforePaydayCents }] : []),
    { label: t("rpt.sec_buffer"), cents: b.netCents },
  ];
  const months = b.bufferMonths === null ? null : decimal(b.bufferMonths, 1);
  const answer =
    months === null
      ? rich("rpt.buf_no_months", { amount: money(b.netCents, false) })
      : rich("rpt.buf_months", { amount: money(b.netCents, false), months, spend: money(b.expectedSpendCents ?? 0, false) });
  return (
    <ReportPanel id={section.id} title={section.title} datum={months === null ? undefined : t("rpt.buf_datum", { months })}>
      <p>{answer}</p>
      <KeyValue items={lines.map((l) => [l.label, money(l.cents, false)] as const)} />
    </ReportPanel>
  );
}

export const section: ReportSection = {
  id: "puskuri",
  get title() {
    return t("rpt.sec_buffer");
  },
  order: 117,
  page: "reports",
  reports: ["buffer"],
  Component: CashBuffer,
};
