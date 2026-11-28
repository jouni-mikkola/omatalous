// Decision: when the household is free of its debts, or what it must add to see that day
import { DebtLanes, type DebtLane, DebtLanesTable } from "../charts/forms/DebtLanes.tsx";
import { monthYear } from "../format.ts";
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
 */
export function DebtFree({ ctx }: SectionProps) {
  const { holdings } = ctx.data.balances;
  const { plan, loans } = ctx.data.loans;
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
  const lanes: DebtLane[] = plan.debts.map((d) => {
    const loan = loans.find((l) => l.id === d.id);
    return { id: d.id, name: loan?.name ?? d.id, balanceCents: loan?.balance.cents ?? null, end: d.endDate, own: d.baseEndDate };
  });
  return (
    <section className="debt-free">
      <p className="debt-say">{t("rpt.dl_say")}</p>
      <p className="debt-hero">{monthYear(plan.debtFreeDate)}</p>
      <QuestionChart id="velaton-kaista" question={t("rpt.dl_q")} table={<DebtLanesTable lanes={lanes} />}>
        <DebtLanes lanes={lanes} today={ctx.meta.today} />
      </QuestionChart>
    </section>
  );
}
