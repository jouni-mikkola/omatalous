// Decision: when the household is free of its debts, or what it must add to see that day, and what 50 euros more a month would change
import { useState } from "react";
import { DebtLanes, type DebtLane, DebtLanesTable } from "../charts/forms/DebtLanes.tsx";
import { money, monthYear } from "../format.ts";
import { QuestionChart } from "../charts/forms/parts.tsx";
import { headAsks, lackingDebts, showsHead } from "../components/net-label.ts";
import { hashOf, LOAN_TERMS_HASH, loansRoute } from "../routes.ts";
import { t, tn } from "../text.ts";
import type { SectionProps } from "./reports/types.ts";
import "../styles/report-debts.css";

/**
 * The head of Varat ja velat. While a debt lacks its balance the day cannot be told, so the head is the ask for the
 * balances (a link to Tarkistettavat while one of them is still asked there, else to Lainat). Otherwise it is the plan's debt-free
 * month and one lane per debt, the plan's own order (dearest first) and dates (`loans.plan`): nothing is worked out
 * here. Nothing shows while the plan is not known or no debt owes.
 *
 * The slider is a trial: it picks one of the server's plans for each step of extra money (`loans.planSteps`, the same
 * `payoffPlan`), keeps the axis of the plan as it stands and saves and sends nothing. It shows only when the server gives steps.
 */
export function DebtFree({ ctx }: SectionProps) {
  const { holdings } = ctx.data.balances;
  const { plan, loans, planSteps } = ctx.data.loans;
  const lacking = lackingDebts(holdings);
  if (!showsHead(ctx.data.balances)) return null;
  if (lacking > 0) {
    const text = tn(lacking, "rpt.dl_ask_one", "rpt.dl_ask_many");
    return (
      <section className="debt-free">
        <a className="debt-ask" href={headAsks(ctx.data.balances) ? LOAN_TERMS_HASH : hashOf(loansRoute())}>
          {text}
        </a>
      </section>
    );
  }
  if (plan === null || plan.debts.length === 0) return null;
  return <DebtPlan plan={plan} steps={planSteps} loans={loans} today={ctx.meta.today} />;
}

type Plan = NonNullable<SectionProps["ctx"]["data"]["loans"]["plan"]>;
type Loans = SectionProps["ctx"]["data"]["loans"];

function DebtPlan({ plan, steps, loans, today }: { plan: Plan; steps: Loans["planSteps"]; loans: Loans["loans"]; today: string }) {
  const [picked, setPicked] = useState(0);
  const step = picked > 0 ? steps[picked - 1] : undefined;
  const shown = step?.plan ?? plan;
  const lanesOf = (p: Plan): DebtLane[] =>
    p.debts.map((d) => {
      const loan = loans.find((l) => l.id === d.id);
      return { id: d.id, name: loan?.name ?? d.id, balanceCents: loan?.balance.cents ?? null, end: d.endDate, own: d.baseEndDate };
    });
  // the lanes keep the order and the axis of the plan as it stands, so a step shortens them in place
  const base = lanesOf(plan);
  const lanes = base.map((l) => ({ ...l, end: shown.debts.find((d) => d.id === l.id)?.endDate ?? l.end }));
  return (
    <section className="debt-free">
      <p className="debt-say">{t("rpt.dl_say")}</p>
      <p className="debt-hero">
        {step && <del className="debt-was">{monthYear(plan.debtFreeDate)}</del>}
        {monthYear(shown.debtFreeDate)}
      </p>
      {step && step.savedMoreCents > 0 && <p className="debt-saved">{t("rpt.dl_saved", { amount: money(step.savedMoreCents, false) })}</p>}
      {steps.length > 0 && (
        <label className="debt-slider">
          <span className="field-label">{t("rpt.dl_slider")}</span>
          <input type="range" min={0} max={steps.length} step={1} value={picked} aria-valuetext={t("rpt.dl_extra", { amount: money(step?.extraCents ?? 0, false) })} onChange={(e) => setPicked(Number(e.target.value))} />
          <output>{t("rpt.dl_extra", { amount: money(step?.extraCents ?? 0, false) })}</output>
        </label>
      )}
      <QuestionChart id="velaton-kaista" question={t("rpt.dl_q")} table={<DebtLanesTable lanes={lanes} />}>
        <DebtLanes lanes={lanes} axisLanes={base} today={today} />
      </QuestionChart>
    </section>
  );
}
