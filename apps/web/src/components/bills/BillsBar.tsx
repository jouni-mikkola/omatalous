/**
 * Decision: can the money on the accounts pay the bills before payday, and which bill breaks first, so the household
 * moves money or a due date before it does.
 *
 * One bar as wide as the bills, its green part as wide as the money that covers them, and under it the bills in due
 * order, each as wide as its sum, so the cut where the money ends falls inside the bill that breaks. On a phone the bills
 * are a list and the split bill is shown half and half. Every figure is core's `billsBeforePayday`; the page adds up nothing.
 * A bill too narrow to carry its words is in the list of the table below.
 */
import type { BillsBeforePayday } from "@banking/core";
import { css } from "../../css.ts";
import { date, answerMoney } from "../../format.ts";
import { t, tn } from "../../text.ts";
import { FigurePanel } from "../FigurePanel.tsx";
import { KeyValue } from "../table/KeyValue.tsx";
import "../../styles/bills-bar.css";

const BALANCES_HASH = "#/settings/banks";

/** The share of the bills a sum is, as a percentage, for a width. */
const share = (cents: number, whole: number): string => `${(100 * cents) / whole}%`;

export function BillsBar({ before, today }: { before: BillsBeforePayday; today: string }) {
  const { bills, billsCents, moneyCents, coveredCents, missingCents, leftOverCount, payday } = before;
  if (bills.length === 0) return null;
  const say = payday ? tn(bills.length, "bills.bar_before_one", "bills.bar_before_many", { date: date(payday, today) }) : tn(bills.length, "bills.bar_days_one", "bills.bar_days_many");
  const known = moneyCents !== null && coveredCents !== null && missingCents !== null && leftOverCount !== null;
  return (
    <section className="card span-12 bills-bar" aria-labelledby="bills-bar-say">
      <p id="bills-bar-say" className="bills-bar-say">
        {say}
      </p>
      <p className="bills-bar-hero">
        <FigurePanel label={t("bills.bar_panel")} figure={<span className="bills-bar-sum">{answerMoney(billsCents)}</span>}>
          <KeyValue
            items={[
              [t("bills.bar_total"), answerMoney(billsCents)],
              ...(known ? [[t("bills.bar_money"), answerMoney(moneyCents)] as const, [t("bills.bar_missing"), answerMoney(missingCents)] as const] : []),
            ]}
          />
          <p className="fig-pop-text">{t("bills.bar_note")}</p>
        </FigurePanel>
        {known && <span className={leftOverCount > 0 ? "bills-bar-over" : "bills-bar-fine"}>{leftOverCount > 0 ? ` · ${tn(leftOverCount, "bills.bar_over_one", "bills.bar_over_many")}` : ` · ${t("bills.bar_enough")}`}</span>}
      </p>
      <div className="bills-bar-tank">
        {known && missingCents > 0 && <span className="bills-bar-cut" aria-hidden="true" ref={css({ left: share(coveredCents, billsCents) })} />}
        {known && (
          <div className="bills-bar-money" aria-hidden="true">
            <span className="bills-bar-have" ref={css({ width: share(Math.min(coveredCents, billsCents), billsCents) })} />
            {missingCents > 0 && <span className="bills-bar-lack" />}
          </div>
        )}
        <ol className="bills-bar-list">
          {bills.map((b, i) => (
            <li
              key={`${b.date}|${b.name}|${i}`}
              className={`bills-bar-bill${known ? ` bills-bar-${b.state}` : ""}`}
              ref={css({ "flex-grow": b.cents, "--have": share(b.coveredCents, b.cents) })}
              title={`${b.name} ${date(b.date, today)} ${answerMoney(b.cents)}`}
            >
              <span className="bills-bar-name">
                {b.name} <span className="bills-bar-day">{date(b.date, today)}</span>
              </span>
              <span className="bills-bar-cents">{answerMoney(b.cents)}</span>
              {known && b.state !== "covered" && <span className="bills-bar-state">{b.state === "split" ? t("bills.bar_split", { covered: answerMoney(b.coveredCents), missing: answerMoney(b.missingCents) }) : t("bills.bar_short")}</span>}
            </li>
          ))}
        </ol>
      </div>
      {known ? (
        <p className="bills-bar-legend">
          <span className="bills-bar-key bills-bar-key-have">{t("bills.bar_have", { sum: answerMoney(moneyCents) })}</span>
          {missingCents > 0 && <span className="bills-bar-key bills-bar-key-lack">{t("bills.bar_lack", { sum: answerMoney(missingCents) })}</span>}
        </p>
      ) : (
        <p className="bills-bar-legend">
          <a className="btn-link" href={BALANCES_HASH}>
            {t("bills.bar_add_balance")}
          </a>
        </p>
      )}
    </section>
  );
}
