/**
 * Decision: how much leaves the accounts before the payday (or in the next 30 days without one), and on which days.
 *
 * Laskut' answer to "Tulevat maksut": the days of its window as one line of dots, a dot to a payment, and over it the one sum, named by the
 * period it covers (to the payday, or the days) and equal to Yhteenveto's payments (`totals.dueCents`). Its parts follow: the bills
 * and a connected card's bill. What is charged
 * after the pay that ends its window, and what a credit card is charged, stand apart from it. The payments themselves
 * are the rows of the table below, never listed twice. "Lisää lasku" opens the form for a bill the history cannot know yet.
 */
import { type AheadGroup } from "@banking/core";
import { useState } from "react";
import { dayMonth, money } from "../../format.ts";
import { figureName, t } from "../../text.ts";
import type { DashboardData } from "../../types.ts";
import { Figure } from "../Figure.tsx";
import { type Active, NextDaysLine } from "../NextDaysLine.tsx";
import { windowLine } from "../next-days.ts";
import { thirtyDayLine } from "../next-days-line.ts";
import "../../styles/ahead.css";
import { Button } from "../ui/Button.tsx";
import { BillForm } from "./BillForm.tsx";

/** The window as GET /api/ahead sends it: with Laskut' groups, their sums and the 30 days' one. */
export type Ahead = NonNullable<DashboardData["ahead"]> & { groups: AheadGroup[]; elsewhereCents: number };

/** Each group's name; the sums are the answer's. */
function groupLabel(g: AheadGroup, ahead: Ahead): string {
  if (g.key === "window" || g.key === "days") {
    // the window's line follows the name after a comma
    const line = windowLine(ahead).replace(/\.$/, "");
    return `${figureName("due")}, ${line.charAt(0).toLowerCase()}${line.slice(1)}`;
  }
  if (g.key === "after") return t("bills.after_pay");
  if (g.key === "card") return t("bills.card_charges");
  return figureName("due");
}

export function Timeline({ ahead, today, onAdded }: { ahead: Ahead | null; today: string; onAdded: () => void }) {
  const [adding, setAdding] = useState(false);
  const [added, setAdded] = useState<string | null>(null);
  const [active, setActive] = useState<Active>(null);
  const line = ahead ? thirtyDayLine(ahead) : null;
  // the window's sum is the one above the line; its parts follow, and what the window leaves out stands apart
  const first = ahead?.groups[0];
  const rows = ahead?.groups.filter((g) => g !== first && g.rows.length > 0) ?? [];
  const cardBills = ahead?.rows.filter((r) => r.source === "card") ?? [];

  return (
    <section className="card bills-time" id="tulossa" aria-labelledby="ahead-h">
      <div className="card-head tb">
        <div className="card-name">
          <h2 id="ahead-h">{t("bills.coming")}</h2>
        </div>
        <div className="card-tool">
          <Button
            onClick={() => {
              setAdding(true);
              setAdded(null);
            }}
          >
            {t("bills.form.add")}
          </Button>
        </div>
      </div>
      {adding && (
        <BillForm
          today={today}
          onCancel={() => setAdding(false)}
          onAdded={(name) => {
            setAdding(false);
            setAdded(name);
            onAdded();
          }}
        />
      )}
      {added && (
        <p className="small muted" role="status">
          {t("bills.added", { name: added })}
        </p>
      )}
      {ahead && (line || rows.some((g) => g.rows.length > 0)) ? (
        <>
          <p className="bills-time-sum">
            <span>{first ? groupLabel(first, ahead) : figureName("due")}</span> <Figure text={money(-ahead.totals.dueCents, false)} size="l" />
          </p>
          {line && <NextDaysLine line={line} active={active} onActive={setActive} />}
          {line && (
            <p className="legend bills-time-legend">
              <span>
                <i className="swatch nd-key nd-t3" aria-hidden="true" />
                {t("bills.legend_known")}
              </span>
              <span>
                <i className="swatch nd-key nd-t3 nd-est" aria-hidden="true" />
                {t("bills.legend_estimate")}
              </span>
              {line.axis.some((d) => d.payday) && (
                <span>
                  <i className="swatch nd-key nd-key-pay" aria-hidden="true" />
                  {t("bills.legend_payday")}
                </span>
              )}
            </p>
          )}
          <dl className="st-rows bills-time-rows">
            {ahead.totals.recurringCents !== 0 && (
              <div className="st-row">
                <dt className="st-name">{t("bills.window_bills")}</dt>
                <dd className="st-num">{money(-ahead.totals.recurringCents)}</dd>
              </div>
            )}
            {ahead.totals.typedCents !== 0 && (
              <div className="st-row">
                <dt className="st-name">{t("bills.kind_typed")}</dt>
                <dd className="st-num">{money(-ahead.totals.typedCents)}</dd>
              </div>
            )}
            {cardBills.map((r) => (
              <div key={`${r.date}${r.name}`} className="st-row">
                <dt className="st-name">{t("bills.window_card", { name: r.name, day: dayMonth(r.date) })}</dt>
                <dd className="st-num">{money(r.cents ?? 0)}</dd>
              </div>
            ))}
            {rows.map((g) => (
              <div key={g.key} className="st-row">
                <dt className="st-name">{groupLabel(g, ahead)}</dt>
                <dd className="st-num">{money(-g.cents)}</dd>
              </div>
            ))}
            {ahead.elsewhereCents !== 0 && (
              <div className="st-row">
                <dt className="st-name">{t("bills.elsewhere")}</dt>
                <dd className="st-num">{money(-ahead.elsewhereCents)}</dd>
              </div>
            )}
          </dl>
        </>
      ) : (
        <p className="small muted">{t("bills.none_30")}</p>
      )}
    </section>
  );
}

