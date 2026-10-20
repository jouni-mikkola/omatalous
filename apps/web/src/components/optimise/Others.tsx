/**
 * Muut havainnot: the insights no finding covers, each a card of the tips' kind with its figure and one key, Ei koske
 * meitä. They are not savings: the figure says what it is (a cost, a rise, a sum drawn) apart from the tips' euros, and
 * the figure opens its rows in Tapahtumat.
 */
import { type Insight, insightDismissSubject } from "@banking/core";
import { useId, useState } from "react";
import { api, query } from "../../api.ts";
import { money, signedMoney } from "../../format.ts";
import { MerchantAvatar } from "../MerchantAvatar.tsx";
import { Section } from "../Section.tsx";
import { Figure } from "../Figure.tsx";
import type { Changed } from "./shared.tsx";

/** A change of spending shows with its sign, any other figure as it is. */
const figureOf = (i: Pick<Insight, "direction" | "yearlyCents">) => (i.direction ? signedMoney(i.direction * i.yearlyCents) : money(i.yearlyCents, false));

/** What the figure is, lower case, by the insight's kind (its id up to the first colon). */
interface Reading {
  figure: (euros: string) => string;
}

const READINGS: Record<string, Reading> = {
  new: { figure: (e) => `maksaa ${e} vuodessa` },
  "subscriptions-added": { figure: (e) => `uudet maksavat ${e} vuodessa` },
  price: { figure: (e) => `nousu ${e} vuodessa` },
  "price-rises": { figure: (e) => `nousu ${e} vuodessa` },
  renewals: { figure: (e) => `maksaa ${e} vuodessa` },
  instalments: { figure: (e) => `maksaa ${e} vuodessa` },
  debt: { figure: (e) => `yli rajan ${e} vuodessa` },
  borrowed: { figure: (e) => `nostettu ${e}` },
  "commitments-share": { figure: (e) => `kasvua ${e} vuodessa` },
  "spending-growth": { figure: (e) => `ero ${e} vuodessa` },
  seasons: { figure: (e) => `lisämenot ${e} vuodessa` },
  "spending-groceries": { figure: (e) => `muutos ${e} vuodessa` },
  payday: { figure: (e) => `palkan jälkeen ${e} vuodessa` },
  "small-purchases": { figure: (e) => `muutos ${e} vuodessa` },
};

/** Lines of working shown open; a longer working folds behind Laskelma so the card stays short on a phone. */
const OPEN_CALC_LINES = 3;

/** The working as Laskelma draws it in a finding (Evidence.tsx): each figure with its name, on one line. */
function CalcLines({ calc }: { calc: NonNullable<Insight["calc"]> }) {
  const line = (
    <dl className="calc-line">
      {calc.map((c, n) => (
        <div key={n}>
          <dt>{c.label}</dt>
          <dd>{c.value}</dd>
        </div>
      ))}
    </dl>
  );
  if (calc.length <= OPEN_CALC_LINES) return line;
  return (
    <details>
      <summary>Laskelma</summary>
      {line}
    </details>
  );
}

const STOPPED_FREED: Reading = { figure: (e) => `vapautui ${e} vuodessa` };
const STOPPED_QUIET: Reading = { figure: (e) => `maksoi ${e} vuodessa` };
const PLAIN: Reading = { figure: (e) => `${e} vuodessa` };

function readingOf(i: Pick<Insight, "id" | "tone">): Reading {
  const kind = i.id.split(":")[0]!;
  if (kind === "stopped") return i.tone === "good" ? STOPPED_FREED : STOPPED_QUIET;
  return READINGS[kind] ?? PLAIN;
}

/** The figure in words, lower case: "maksaa 276 € vuodessa". Päätetyt says it as the card did. */
export const insightFigure = (i: Pick<Insight, "id" | "tone" | "direction" | "yearlyCents">) => readingOf(i).figure(figureOf(i));

/** The words under the figure: the reading without its euros ("maksaa vuodessa", "nousu vuodessa"). */
const unitOf = (i: Pick<Insight, "id" | "tone">) => readingOf(i).figure("").replace(/\s+/g, " ").trim();

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
  const figure = (
    <>
      <span className="tip-fig">
        <Figure text={figureOf(i)} size="m" />
      </span>
      <span className="tip-unit">{unitOf(i)}</span>
    </>
  );
  return (
    <article className="tip other" aria-labelledby={titleId}>
      <div className="tip-main">
        <div className="other-head">
          {i.merchant && <MerchantAvatar name={i.merchant} size="s" />}
          <p className="tip-title" id={titleId}>
            {i.title}
          </p>
        </div>
        <p className="tip-action">{i.detail}</p>
        {i.calc && i.calc.length > 0 && <CalcLines calc={i.calc} />}
      </div>
      {/* the figure opens its rows: no link text, the pointer and the focus ring are the cue */}
      {i.link ? (
        <a className="tip-figure" href={`#/transactions${query({ ...i.link })}`} aria-label={`Näytä rivit: ${i.title}`}>
          {figure}
        </a>
      ) : (
        <div className="tip-figure tip-figure-still">{figure}</div>
      )}
      <div className="tip-actions">
        <div className="finding-actions">
          <button className="btn btn-small decide-key" type="button" disabled={busy} aria-busy={busy || undefined} aria-describedby={titleId} onClick={dismiss}>
            Ei koske meitä
          </button>
          {error && (
            <div className="field-error error" role="alert">
              {error}
            </div>
          )}
        </div>
      </div>
    </article>
  );
}

export function Others({ others, onChanged, half = false }: { others: readonly Insight[]; onChanged: Changed; half?: boolean }) {
  if (!others.length) return null;
  return (
    <Section id="muut-havainnot" title="Muut havainnot" half={half}>
      <div className="tips">
        {others.map((i) => (
          <OtherCard key={i.id} insight={i} onChanged={onChanged} />
        ))}
      </div>
    </Section>
  );
}
