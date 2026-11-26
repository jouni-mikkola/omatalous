import { language, money } from "./format.ts";
import { t } from "./text.ts";

/** "2 700–3 260 €": the low end without its sign of currency in Finnish, as the glossary writes a range. */
export function rangeText(low: number, high: number): string {
  const lowText = language() === "en" ? money(low, false) : money(low, false).replace(/\s€$/, "");
  return t("home.days_range", { low: lowText, high: money(high, false) });
}
