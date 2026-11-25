/**
 * Decision: on which days of the picked month the bills fall, and whether they come before or after the pay.
 *
 * One bar a day of the month, as high as that day's bills still to pay (`billDays` of core's bill calendar, the day's sum is
 * core's), the days of a pay marked. A bar's height is a share of the dearest day, drawn here and told nowhere as money;
 * every sum and day is a row of the table under it.
 */
import { daysInMonth } from "@banking/core";
import { css } from "../../css.ts";
import { monthLong } from "../../format.ts";
import { t } from "../../text.ts";
import type { CalMonth } from "./calendar-rows.ts";

/** The days that carry their number under the bar: the first and every fifth, so 31 days fit a phone. */
const labelled = (day: number) => day === 1 || day % 5 === 0;

export function BillDays({ month }: { month: CalMonth }) {
  const cents = new Map(month.billDays.map((d) => [d.date, d.cents]));
  const paydays = new Set(month.rows.filter((r) => r.kind === "income").map((r) => r.date));
  const dearest = Math.max(0, ...cents.values());
  const days = Array.from({ length: daysInMonth(month.month) }, (_, i) => i + 1);
  return (
    <div className="bill-days" role="img" aria-label={t("bills.days_label", { month: monthLong(month.month) })}>
      {days.map((day) => {
        const date = `${month.month}-${String(day).padStart(2, "0")}`;
        const share = dearest > 0 ? ((cents.get(date) ?? 0) / dearest) * 100 : 0;
        const pay = paydays.has(date);
        return (
          <div key={date} className={pay ? "bill-day bill-day-pay" : "bill-day"}>
            {pay && <b>{t("bills.day_pay")}</b>}
            <i ref={css({ "block-size": `${share}%` })} />
            <span>{labelled(day) || pay ? day : ""}</span>
          </div>
        );
      })}
    </div>
  );
}
