import type { ReactNode } from "react";
import { Figure } from "../../components/Figure.tsx";
import { t } from "../../text.ts";
import { Button } from "../../components/ui/Button.tsx";
/** Under a table of expense categories when one of them totals below zero (Categories and Pivot say it alike). */
/** The two figures of the saved-debt rows: core's constants are Finnish, these follow the language. */
export const sameDebtTwice = (): string => t("rpt.same_debt_twice");
export const accountsLessDebt = () => ({ label: t("rpt.accounts_less_debt"), sub: t("rpt.accounts_less_debt_sub") });
export const negativeTotalNote = (): string => t("rpt.negative_total");

/** The text of a card's datum with the period it sums, when the page names one. */
export const inSpan = (ctx: { span?: string }, text: string): string => (ctx.span ? `${text}, ${ctx.span}` : text);

export function ExportLink({ href }: { href: string }) {
  return (
    <Button variant="link" href={href} download>
      {t("rpt.download_csv")}
    </Button>
  );
}

/** Label and figure pairs; a third item wraps the figure (the button that opens its rows). */
export function Kv({ items }: { items: ([string, string] | [string, string, (figure: ReactNode) => ReactNode])[] }) {
  return (
    <div className="kv">
      {items.map(([k, v, wrap]) => (
        <div key={k}>
          <div className="k">{k}</div>
          <div className="v">{wrap ? wrap(<Figure text={v} size="m" />) : <Figure text={v} size="m" />}</div>
        </div>
      ))}
    </div>
  );
}
