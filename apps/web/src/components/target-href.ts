import { type Insight, QUESTIONS } from "@banking/core";
import { query } from "../api.ts";

/** Where the action of an insight opens: the rows, the bills or a report section. */
export function targetHref(target: Insight["action"]["target"]): string {
  if (target.page === "transactions") return `#/transactions${query({ ...target.filter })}`;
  if (target.page === "bills") return "#/bills";
  // an anchor starts with the question that holds it ("kiinteat-hinnat"), so the link opens that page first
  const question = QUESTIONS.find((q) => target.anchor === q || target.anchor.startsWith(`${q}-`));
  return `#/reports${question ? `?q=${question}` : ""}#${target.anchor}`;
}
