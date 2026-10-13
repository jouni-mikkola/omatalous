import type { MarkKind } from "@banking/core";
import { useState } from "react";
import { api } from "../api.ts";
import { useApi } from "../hooks.ts";
import type { DashboardData } from "../types.ts";
import { MAX_ROWS, type Notice, noticesOf, type SecurityNotice, type Send } from "./notices.ts";
import "../styles/notices.css";

/** What the household said about a row: the id it hides, the subject to store and the mark. */
type OnAnswer = (id: string, subject: string, mark: MarkKind) => void;

function Row({ notice: n, onPress, busy }: { notice: Notice; onPress: (n: Notice, send: Send) => void; busy: boolean }) {
  const text = (
    <>
      <span className="sr-only">{n.read}: </span>
      <span className="notice-title">{n.title}</span>
      {n.detail && <span className="notice-detail"> {n.detail}</span>}
    </>
  );
  // the line is cut where it does not fit: the whole of it is in the title attribute
  const whole = n.detail ? `${n.title} ${n.detail}` : n.title;
  return (
    <li className={`st-row notice-item${n.warning ? " warn" : ""}`}>
      {n.href && !n.link ? (
        <a className="st-name notice-text" href={n.href} title={whole}>
          {text}
        </a>
      ) : (
        <span className="st-name notice-text" title={whole}>
          {text}
        </span>
      )}
      {(n.answers.length > 0 || n.link) && (
        <div className="notice-actions">
          {n.link && n.href && (
            <a href={n.href} aria-label={`${n.link}: ${n.detail || n.title}`}>
              {n.link}
            </a>
          )}
          {n.answers.map((a) => (
            <button key={a.label} className={a.label === "Kuittaa" ? "btn btn-small" : "link-btn"} type="button" disabled={busy} aria-label={a.name} onClick={() => onPress(n, a.send)}>
              {a.label}
            </button>
          ))}
        </div>
      )}
    </li>
  );
}

/**
 * Ilmoitukset: what the user must act on, as one card at the foot of Yhteenveto, at most four rows of one line each: the
 * title and its detail, and at the right Kuittaa where the row can be set aside. The row's text is its link; a row
 * that names what to do (Luokittele) has those words as its link at the right, and its text is plain. A warning has a
 * triangle before its title; nothing else is coloured. With more than four, the head links to Säästövinkit (while it is
 * switched on) with the count. The notices of the server (a sign-in from a new device) are read here: Kuittaa on one
 * of them reads them all. With nothing to show there is no card. A failed answer shows the server's sentence under the
 * list and the row stays.
 */
export function Notices({
  data,
  range,
  answered,
  insights,
  onAnswer,
  busy,
  error,
}: {
  data: Pick<DashboardData, "dataNotice" | "alerts" | "insights">;
  range: { from: string; to: string };
  answered: ReadonlySet<string>;
  /** Whether the insights belong here: Säästövinkit tells them while it is switched on, and then the head can lead to it. */
  insights: boolean;
  onAnswer: OnAnswer;
  busy: boolean;
  error: string | null;
}) {
  const security = useApi<{ notices: SecurityNotice[] }>("/api/security/notices");
  const [reading, setReading] = useState(false);
  const [readError, setReadError] = useState<string | null>(null);
  const { rows, total } = noticesOf(data, { range, answered, insights, security: security.data?.notices ?? [] });
  if (!rows.length) return null;

  const press = (n: Notice, send: Send) => {
    if (send !== "seen") {
      onAnswer(n.id, send.subject, send.mark);
      return;
    }
    setReading(true);
    setReadError(null);
    api("/api/security/notices/seen", { method: "POST" })
      .then(() => security.reload())
      .catch((e: Error) => setReadError(e.message))
      .finally(() => setReading(false));
  };
  const failed = error ?? readError;
  return (
    <section className="card" aria-labelledby="notices-h">
      <div className="card-head tb">
        <div className="card-name">
          <h2 id="notices-h">Ilmoitukset</h2>
        </div>
        {total > MAX_ROWS && !insights && (
          <div className="card-tool">
            <a href="#/optimise">Kaikki ({total})</a>
          </div>
        )}
      </div>
      <ul className="st-rows notice-list" aria-labelledby="notices-h">
        {rows.map((n) => (
          <Row key={`${n.kind}:${n.id}`} notice={n} onPress={press} busy={busy || reading} />
        ))}
      </ul>
      {failed && (
        <p className="error notice-error" role="alert">
          {failed}
        </p>
      )}
    </section>
  );
}
