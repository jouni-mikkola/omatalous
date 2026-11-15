// Decision: on which days do the payments pile up before the payday
import { carriesLabel, stackBars } from "../../charts/payment-bars.ts";
import { css } from "../../css.ts";
import { moneyTick } from "../../format.ts";
import { t } from "../../text.ts";
import type { BillLine } from "../next-days-line.ts";
import type { Active } from "../NextDaysLine.tsx";

/**
 * The days from today to the payday as bars: a day is a bar, each payment of the day a piece of it, and the height is
 * the euros. A payment the app estimates is a pale piece with an outline, a given one is solid. The payday is a named
 * line at the end. The list under it says all of it in text, so the drawing is for the eyes and a piece lights its row.
 */
export function PaymentBars({ line, active, onActive }: { line: BillLine; active: Active; onActive: (a: Active) => void }) {
  const { axis, bills } = line;
  const columns = axis.length;
  const { pieces, ticks, at } = stackBars(bills.map((b) => ({ column: b.column, cents: b.cents })));
  const paydayLast = axis[columns - 1]?.payday === true;
  return (
    <div className={active ? "pb has-on" : "pb"} aria-hidden="true">
      {paydayLast && <p className="pb-flag">{t("rpt.bl_payday")}</p>}
      <div className="pb-plot">
        {ticks
          .filter((tick) => tick > 0)
          .map((tick) => (
            <i key={tick} className="pb-grid" ref={css({ bottom: `${at(tick) * 100}%` })} />
          ))}
        <ol className="pb-cols" ref={css({ "grid-template-columns": `repeat(${columns}, minmax(0, 1fr))` })}>
          {axis.map((d, k) => (
            <li key={d.iso} className="pb-col" data-payday={d.payday ? "" : undefined} data-weekend={d.weekend ? "" : undefined}>
              {pieces
                .filter((p) => p.column === k)
                .map((p) => {
                  const bill = bills[p.index]!;
                  const lit = active?.kind === "bill" && active.row === bill.row;
                  return (
                    <span
                      key={bill.row}
                      className="pb-piece"
                      data-estimate={bill.estimate ? "" : undefined}
                      data-on={lit ? "" : undefined}
                      ref={css({ height: `${(p.to - p.from) * 100}%` })}
                      onPointerEnter={() => onActive({ kind: "bill", row: bill.row })}
                      onPointerLeave={() => onActive(null)}
                    />
                  );
                })}
            </li>
          ))}
        </ol>
      </div>
      <div className="pb-scale">
        {ticks
          .filter((tick) => tick > 0)
          .map((tick) => (
            <span key={tick} ref={css({ bottom: `${at(tick) * 100}%` })}>
              {moneyTick(tick)}
            </span>
          ))}
      </div>
      <ol className="pb-axis" ref={css({ "grid-template-columns": `repeat(${columns}, minmax(0, 1fr))` })}>
        {axis.map((d, k) => (
          <li key={d.iso} data-payday={d.payday ? "" : undefined}>
            {carriesLabel(columns, k) && (
              <>
                <span>{d.weekday}</span>
                {d.day}.
              </>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
