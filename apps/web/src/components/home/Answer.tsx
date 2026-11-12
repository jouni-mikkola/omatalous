// Decision: how much can we still spend before payday, and what is that sum made of
import { hashOf } from "../../routes.ts";
import { answerMoney, dayMonth, money } from "../../format.ts";
import { t } from "../../text.ts";
import type { DashboardData } from "../../types.ts";
import { Figure } from "../Figure.tsx";
import { noPaydayText } from "./texts.ts";

type NytData = NonNullable<DashboardData["nyt"]>;

export const reportHref = (q?: string) => hashOf({ page: "reports", params: new URLSearchParams(q ? { q } : {}) });

/** Why there is no sum to say. */
function unknownText(left: Extract<NytData["left"], { known: false }>): string {
  if (left.reason === "late") return t("home.gap_late");
  if (left.reason === "no-balance") return t("home.no_balance");
  return noPaydayText(left.found);
}

/**
 * The first block of Yhteenveto: the sum left before the payday and what it is a day on the left, the sum row that
 * makes it on the right (balance, payments before the payday, what is left, to the cent). Every figure is a field of
 * `nyt`; nothing is added up here. The balance opens the accounts and the payments open their rows on Laskut.
 */
export function Answer({ nyt }: { nyt: NytData }) {
  const { left, usualPerDayCents } = nyt;
  const perDay =
    left.known && left.days > 0
      ? usualPerDayCents !== null
        ? t("home.nyt_per_day_usual", { sum: answerMoney(left.perDayCents), usual: answerMoney(usualPerDayCents) })
        : t("home.nyt_per_day", { sum: answerMoney(left.perDayCents) })
      : usualPerDayCents !== null
        ? t("home.nyt_usual_per_day", { sum: answerMoney(usualPerDayCents) })
        : null;
  return (
    <section className="home-answer" aria-labelledby="home-question">
      <div className="home-answer-main">
        {left.known ? (
          <h2 id="home-question" className={`home-answer-line${left.leftCents < 0 ? " home-short" : ""}`}>
            <span>{t("home.nyt_left", { date: dayMonth(left.payday.date) })}</span> <Figure text={answerMoney(left.leftCents)} size="l" />
          </h2>
        ) : (
          <h2 id="home-question" className="home-answer-line">
            {unknownText(left)}
          </h2>
        )}
        {perDay && <p className="home-detail home-per-day">{perDay}</p>}
      </div>
      {left.known && (
        <dl className="home-sum-row">
          <div>
            <dt>{t("home.accounts_balance")}</dt>
            <dd className="num">
              <a href={reportHref("saldot")}>{money(left.balanceCents)}</a>
            </dd>
          </div>
          <div>
            <dt>{t("home.payments_before_payday")}</dt>
            <dd className="num">
              {/* a sum of nothing has no sign: "−0,00 €" read as a fault */}
              <a href={hashOf({ page: "bills", params: new URLSearchParams(), anchor: "ennen-palkkapaivaa" })}>{left.billsCents > 0 ? `−${money(left.billsCents)}` : money(0)}</a>
            </dd>
          </div>
          <div className="home-sum-left">
            <dt>{t("home.left")}</dt>
            <dd className="num">{money(left.leftCents)}</dd>
          </div>
        </dl>
      )}
    </section>
  );
}
