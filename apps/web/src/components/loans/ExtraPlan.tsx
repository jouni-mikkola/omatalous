// Decision: how much more to pay a month on the debts, by when that ends them
import type { LoansReport } from "@banking/core";
import { useState } from "react";
import { DebtExtra, DebtExtraTable, extraName } from "../../charts/forms/DebtExtra.tsx";
import { QuestionChart } from "../../charts/forms/parts.tsx";
import { money, monthLongIn } from "../../format.ts";
import { t, tn } from "../../text.ts";
import { Segmented } from "../ui/Segmented.tsx";

type Scenario = LoansReport["extra"][number];

/** What a chosen extra payment does, in sentences: the month the debts end, how much earlier, what it saves, and the buffer it fills first. */
function answer(s: Scenario | undefined, baseDebtFree: string): string {
  const month = (day: string) => monthLongIn(day.slice(0, 7));
  if (s === undefined) return t("rpt.ln_extra_answer_none", { month: month(baseDebtFree) });
  return [
    t("rpt.ln_extra_answer", { amount: money(s.extraCents, false), month: month(s.debtFreeDate) }),
    s.monthsEarlier > 0 && tn(s.monthsEarlier, "rpt.ln_extra_earlier_one", "rpt.ln_extra_earlier_many"),
    s.savedCents > 0 && t("rpt.ln_extra_saved", { amount: money(s.savedCents, false) }),
    s.bufferCents > 0 && s.bufferFullDate !== null && t("rpt.ln_extra_buffer", { amount: money(s.bufferCents, false), month: month(s.bufferFullDate) }),
  ]
    .filter(Boolean)
    .join(" ");
}

/**
 * Milloin velaton: the extra monthly payments the server worked out (`loans.extra`) as one choice above the debt line.
 * The page only switches between them; the dashed line is the debts' own payments. At least one scenario is given.
 */
export function ExtraPlan({ path, extra }: { path: NonNullable<LoansReport["path"]>; extra: readonly Scenario[] }) {
  // opens on the middle one of the server's choices, so both a smaller and a larger one are a step away
  const [picked, setPicked] = useState<string>(String(extra[Math.floor(extra.length / 2)]!.extraCents));
  const scenario = extra.find((s) => String(s.extraCents) === picked);
  return (
    <QuestionChart id="lainat-extra" question={t("rpt.ln_q_extra")} answer={answer(scenario, path.payoff ?? path.days.at(-1)!)} table={<DebtExtraTable path={path} extra={extra} />}>
      <Segmented
        className="qc-choice"
        label={t("rpt.ln_extra_choice")}
        value={scenario ? picked : "0"}
        options={[{ value: "0", label: t("rpt.ln_extra_none") }, ...extra.map((s) => ({ value: String(s.extraCents), label: extraName(s) }))]}
        onChange={setPicked}
      />
      <DebtExtra path={path} scenario={scenario ?? null} />
    </QuestionChart>
  );
}
