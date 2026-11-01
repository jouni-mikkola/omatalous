import type { PayerRole } from "@banking/core";
import { useState } from "react";
import { payerCalls } from "../api.ts";
import { tn, t } from "../text.ts";
import { useApi } from "../hooks.ts";
import { PAYER_ROLE_LABEL } from "./questions.ts";
import "../styles/questions.css";
import { Button } from "./ui/Button.tsx";
import { Notice } from "./ui/Notice.tsx";
interface Answer {
  key: string;
  name: string;
  role: PayerRole;
  options: PayerRole[];
  count: number;
}

/**
 * Maksajat: the member's own answers to "Mitä nämä ovat?", where the other standing rules are. An answer can be changed
 * here (stored at once, the past months move with it) or taken back with Palauta ehdotus, which asks about the payer
 * again. Nothing is drawn while the member has answered none.
 */
export function PayerAnswers() {
  const { data, error: loadError, reload } = useApi<{ answers: Answer[] }>("/api/payer-roles");
  const [pending, setPending] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  if (!data?.answers.length && !loadError) return null;

  // one request at a time: the rows move with every answer
  const send = async (key: string, role: PayerRole | null) => {
    if (pending) return;
    setPending(key);
    setFailed(null);
    try {
      await payerCalls.say(key, role);
      reload();
    } catch (err) {
      setFailed((err as Error).message);
    } finally {
      setPending(null);
    }
  };
  const problem = failed ?? loadError;

  return (
    <div className="card">
      <div className="card-head tb">
        <div className="card-name">
          <h2>{t("payers.title")}</h2>
        </div>
      </div>
      {problem && <Notice tone="error" className="question-error">{problem}</Notice>}
      {!!data?.answers.length && (
        <ul className="st-rows question-list" aria-label={t("payers.title")}>
          {data.answers.map((a) => (
            <li key={a.key} className="st-row question-row">
              <span className="st-name" title={a.name}>
                {a.name}
              </span>
              <span className="question-count">{tn(a.count, "tx.event_one", "tx.event_many")}</span>
              <span className="question-actions question-payer">
                <select aria-label={t("payers.what_are", { name: a.name })} value={a.role} disabled={pending !== null} onChange={(e) => void send(a.key, e.target.value as PayerRole)}>
                  {a.options.map((role) => (
                    <option key={role} value={role}>
                      {PAYER_ROLE_LABEL[role]}
                    </option>
                  ))}
                </select>
                <Button variant="link" disabled={pending !== null} aria-busy={pending === a.key || undefined} aria-label={t("payers.undo_of", { name: a.name })} onClick={() => void send(a.key, null)}>
                  {t("payers.undo")}
                </Button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
