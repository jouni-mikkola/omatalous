import { useState } from "react";
import { api, loanCalls, payerCalls, query } from "../api.ts";
import { money, plural } from "../format.ts";
import { SETTINGS_ANCHOR } from "../routes.ts";
import type { Category, DashboardData } from "../types.ts";
import { PayeeCategorySelect, usePayeeCategory } from "./PayeeCategory.tsx";
import { asks, classifiedPercent, PAYER_ROLE_LABEL } from "./questions.ts";
import "../styles/questions.css";

type Item = DashboardData["questions"]["items"][number];

const keyOf = (q: Item) => (q.kind === "loan" || q.kind === "payer" ? `${q.kind}:${q.key}` : `${q.kind}:${q.merchant}`);

/**
 * Luokittelemattomat: how much of the last twelve months' money is classified, and the few answers that would mend it
 * most, largest first: a payee without a category (pick one, or Ohita), a monthly payment that looks like a loan
 * (Tallenna lainaksi in Asetukset > Lainat, or Ei laina). Every answer is stored at once and `onAnswered` reads the page's
 * answer again, so the row goes, the next comes and the percent moves. Nothing is drawn when the picture is nearly whole
 * and nothing is asked.
 */
export function Questions({ questions, categories, onAnswered }: { questions: DashboardData["questions"]; categories: Category[]; onAnswered: () => void }) {
  const [pending, setPending] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const category = usePayeeCategory(onAnswered);
  if (!asks(questions) || questions.share === null) return null;

  const answer = async (key: string, send: () => Promise<unknown>) => {
    setPending(key);
    setFailed(null);
    try {
      await send();
      onAnswered();
    } catch (err) {
      setFailed((err as Error).message);
    } finally {
      setPending(null);
    }
  };
  const busy = pending !== null || category.busy !== null;
  const problem = failed ?? category.error;

  return (
    <section className="card st-block" aria-labelledby="questions-h">
      <div className="card-head tb">
        <div className="card-name">
          <h2 id="questions-h">Luokittelemattomat</h2>
        </div>
        {questions.total > questions.items.length && (
          <div className="card-tool">
            <a href="#/transactions?category=other">Näytä kaikki ({questions.total})</a>
          </div>
        )}
      </div>
      <p className="question-line">Luokiteltu {classifiedPercent(questions.share)} % viimeisen 12 kuukauden tuloista ja menoista.</p>
      {questions.cardBillCents > 0 && (
        <>
          <p className="question-line">Korttilaskuissa on {money(questions.cardBillCents)} ostoja, joita ei ole eritelty.</p>
          <p className="question-line">
            <a href={`#/settings#${SETTINGS_ANCHOR.quality}`}>Tietojen laatu</a>
          </p>
        </>
      )}
      {questions.items.length > 0 && (
        <ul className="st-rows question-list" aria-labelledby="questions-h">
          {questions.items.map((q) =>
            q.kind === "payer" ? (
              <li key={keyOf(q)} className="st-row question-row">
                <span className="st-name" title={q.merchant}>
                  <a href={`#/transactions${query({ merchant: q.merchant })}`}>{q.merchant}</a>
                </span>
                <span className="st-num">{money(q.cents)}</span>
                <span className="question-count">{plural(q.count, "tapahtuma", "tapahtumaa")}</span>
                <span className="question-actions question-payer">
                  <select
                    aria-label={`Mitä nämä ovat: ${q.merchant}`}
                    value=""
                    disabled={busy}
                    onChange={(e) => {
                      const role = e.target.value as (typeof q.options)[number];
                      void answer(keyOf(q), () => payerCalls.say(q.key, role));
                    }}
                  >
                    <option value="" disabled>
                      Mitä nämä ovat?
                    </option>
                    {q.options.map((role) => (
                      <option key={role} value={role}>
                        {PAYER_ROLE_LABEL[role]}
                        {role === q.proposal ? " (ehdotus)" : ""}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="btn btn-small"
                    disabled={busy}
                    aria-busy={pending === keyOf(q) || undefined}
                    aria-label={`Ohita: ${q.merchant}`}
                    onClick={() => void answer(keyOf(q), () => api("/api/marks", { method: "PUT", body: { subject: `question:payee:${q.key}`, mark: "dismissed" } }))}
                  >
                    Ohita
                  </button>
                </span>
              </li>
            ) : q.kind === "loan" ? (
              <li key={keyOf(q)} className="st-row question-row">
                <span className="st-name" title={q.payee}>
                  {q.payee}
                </span>
                <span className="st-num">toistuva maksu {money(q.paymentCents)}/kk</span>
                <span className="question-actions">
                  <a className="btn btn-small" href={`#/settings#${SETTINGS_ANCHOR.loans}`} aria-label={`Tallenna lainaksi: ${q.payee}`}>
                    Tallenna lainaksi
                  </a>
                  <button type="button" className="btn btn-small" disabled={busy} aria-busy={pending === keyOf(q) || undefined} aria-label={`Ei laina: ${q.payee}`} onClick={() => void answer(keyOf(q), () => loanCalls.notLoan(q.key))}>
                    Ei laina
                  </button>
                </span>
              </li>
            ) : (
              <li key={keyOf(q)} className="st-row question-row">
                <span className="st-name" title={q.merchant}>
                  <a href={`#/transactions${query({ merchant: q.merchant })}`}>{q.merchant}</a>
                  {q.kind === "payee_in" && " tulo"}
                </span>
                <span className="st-num">{money(q.cents)}</span>
                <span className="question-count">{plural(q.count, "tapahtuma", "tapahtumaa")}</span>
                <span className="question-actions">
                  <PayeeCategorySelect categories={categories} merchant={q.merchant} incomeOnly={q.kind === "payee_in"} disabled={busy} onPick={(c) => void category.save(q.merchant, c)} />
                  <button
                    type="button"
                    className="btn btn-small"
                    disabled={busy}
                    aria-busy={pending === keyOf(q) || undefined}
                    aria-label={`Ohita: ${q.merchant}`}
                    onClick={() => void answer(keyOf(q), () => api("/api/marks", { method: "PUT", body: { subject: `question:payee:${q.merchant}`, mark: "dismissed" } }))}
                  >
                    Ohita
                  </button>
                </span>
              </li>
            ),
          )}
        </ul>
      )}
      {questions.items.some((q) => q.kind === "payer") && <p className="question-line">Vastaus koskee myös aiempia kuukausia. Tavallisesta selvästi poikkeavia maksuja se ei muuta.</p>}
      {problem && (
        <p className="error question-error" role="alert">
          {problem}
        </p>
      )}
    </section>
  );
}
