// Decision: how much can we still spend before payday, and what is that sum made of
import { hashOf } from "../../routes.ts";
import { answerMoney, dayMonth, money } from "../../format.ts";
import { t } from "../../text.ts";
import type { DashboardData, Scope } from "../../types.ts";
import { Figure } from "../Figure.tsx";
import { Why } from "../Why.tsx";
import { noPaydayText } from "./texts.ts";

type NytData = NonNullable<DashboardData["nyt"]>;

export const reportHref = (q?: string) => hashOf({ page: "reports", params: new URLSearchParams(q ? { q } : {}) });

/** Laskut's list of the payments before the payday, where an account outside the balance has its rows too. */
const beforePaydayHref = hashOf({ page: "bills", params: new URLSearchParams(), anchor: "ennen-palkkapaivaa" });

/** Why there is no sum to say. */
function unknownText(left: Extract<NytData["left"], { known: false }>): string {
  if (left.reason === "late") return t("home.gap_late");
  if (left.reason === "no-balance") return t("home.no_balance");
  return noPaydayText(left.found);
}

/**
 * The first block of Yhteenveto: the sum left before the payday and what it is a day on the left, the sum row that
 * makes it on the right (balance, payments before the payday, what is left, to the cent). Every figure is a field of
 * `nyt`; nothing is added up here. The balance opens the accounts, the payments open their rows on Laskut, and what is
 * left opens its basis (`ahead.free`): the accounts the balance adds up and each payment taken off. The balance's name
 * says whether it is one account or several (`ahead.balance.accounts`), and what an account the balance leaves out pays
 * before the payday is said under the row: the payments read 0 when only such an account pays.
 */
export function Answer({ nyt, ahead, scope }: { nyt: NytData; ahead: DashboardData["ahead"]; scope: Scope }) {
  const { left, usualPerDayCents } = nyt;
  const several = (ahead?.balance?.accounts ?? 1) > 1;
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
            <dt>{t(several ? "home.accounts_balance_many" : "home.accounts_balance")}</dt>
            <dd className="num">
              <a href={reportHref("saldot")}>{money(left.balanceCents)}</a>
            </dd>
          </div>
          <div>
            <dt>{t("home.payments_before_payday")}</dt>
            <dd className="num">
              {/* a sum of nothing has no sign: "−0,00 €" read as a fault */}
              <a href={beforePaydayHref}>{left.billsCents > 0 ? `−${money(left.billsCents)}` : money(0)}</a>
            </dd>
          </div>
          <div className="home-sum-left">
            <dt>{t("home.left")}</dt>
            <dd className="num">
              {ahead ? (
                <Why figure="ahead.free" title={t("home.left")} range={{ from: ahead.from, to: ahead.to }} scope={scope} text={money(left.leftCents)}>
                  {money(left.leftCents)}
                </Why>
              ) : (
                money(left.leftCents)
              )}
            </dd>
          </div>
        </dl>
      )}
      {left.known && left.elsewhereCents > 0 && (
        <p className="home-detail home-elsewhere">
          <a href={beforePaydayHref}>{t("home.payments_elsewhere", { sum: money(left.elsewhereCents) })}</a>
        </p>
      )}
    </section>
  );
}
