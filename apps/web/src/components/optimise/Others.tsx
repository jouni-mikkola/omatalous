/** Muut havainnot: the insights no finding covers, each with its figure, its rows and the page's Ei koske meitä. */
import { type Insight, insightDismissSubject } from "@banking/core";
import { useId, useState } from "react";
import { api, query } from "../../api.ts";
import { money, signedMoney } from "../../format.ts";
import { Section } from "../Section.tsx";
import type { Changed } from "./shared.tsx";

/** The tone shows as the card's left edge; screen readers get it as a word. */
const TONE: Record<Insight["tone"], string> = { good: "Hyvä", warning: "Huomio", info: "Tiedoksi" };

/** A change of spending shows with its sign, any other figure as it is. */
export const insightFigure = (i: Pick<Insight, "direction" | "yearlyCents">) => (i.direction ? signedMoney(i.direction * i.yearlyCents) : money(i.yearlyCents, false));

function OtherCard({ insight: i, onChanged }: { insight: Insight; onChanged: Changed }) {
  const titleId = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // the mark holds the figure, so the insight returns when it moves 25 % (core's rule)
  const dismiss = () => {
    setBusy(true);
    setError(null);
    api("/api/marks", { method: "PUT", body: { subject: insightDismissSubject(i), mark: "dismissed" } })
      .then(() => onChanged("Havainto siirrettiin kohtaan Päätetyt."))
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(false));
  };
  return (
    <article className={`other ${i.tone}`} aria-labelledby={titleId}>
      <div className="finding-top">
        <div className="finding-main">
          <span className="sr-only">{TONE[i.tone]}: </span>
          <p className="finding-title" id={titleId}>
            {i.title}
          </p>
          <p className="small muted">{i.detail}</p>
        </div>
        <div className="finding-money">
          <strong className="finding-euros">{insightFigure(i)} vuodessa</strong>
        </div>
      </div>
      <div className="finding-actions">
        <div className="form-row">
          {i.link && (
            <a className="btn btn-small" href={`#/transactions${query({ ...i.link })}`} aria-describedby={titleId}>
              Näytä tapahtumat
            </a>
          )}
          <button className="btn btn-small" type="button" disabled={busy} aria-describedby={titleId} onClick={dismiss}>
            Ei koske meitä
          </button>
        </div>
        {error && (
          <div className="field-error error" role="alert">
            {error}
          </div>
        )}
      </div>
    </article>
  );
}

export function Others({ others, onChanged }: { others: readonly Insight[]; onChanged: Changed }) {
  if (!others.length) return null;
  return (
    <Section id="muut-havainnot" title="Muut havainnot" sub="Tämän kuun tiedoista. Eivät kuulu yhteissummaan.">
      <div className="findings">
        {others.map((i) => (
          <OtherCard key={i.id} insight={i} onChanged={onChanged} />
        ))}
      </div>
    </Section>
  );
}
