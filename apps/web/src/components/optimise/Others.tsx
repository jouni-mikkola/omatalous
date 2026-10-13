/**
 * Muut havainnot: the insights no finding covers, each with its figure, its rows and the page's Ei koske meitä. They are
 * not savings: the figure says what it is (a cost, a rise, a sum drawn) apart from the tips' euros, with what to do.
 */
import { type Insight, insightDismissSubject } from "@banking/core";
import { useId, useState } from "react";
import { api, query } from "../../api.ts";
import { money, signedMoney } from "../../format.ts";
import { Section } from "../Section.tsx";
import type { Changed } from "./shared.tsx";

/** The tone shows as a badge with its word; the badge takes the colour of the tone. */
const TONE: Record<Insight["tone"], string> = { good: "Hyvä", warning: "Huomio", info: "Tiedoksi" };

const TONE_BADGE: Record<Insight["tone"], string> = { good: "good", warning: "warn", info: "" };

/** A change of spending shows with its sign, any other figure as it is. */
const figureOf = (i: Pick<Insight, "direction" | "yearlyCents">) => (i.direction ? signedMoney(i.direction * i.yearlyCents) : money(i.yearlyCents, false));

/** What the figure is, lower case, and what to do about it, by the insight's kind (its id up to the first colon). */
interface Reading {
  figure: (euros: string) => string;
  todo: string | null;
}

const READINGS: Record<string, Reading> = {
  new: { figure: (e) => `maksaa ${e} vuodessa`, todo: "Tarkista, onko palvelu käytössä." },
  "subscriptions-added": { figure: (e) => `uudet maksavat ${e} vuodessa`, todo: "Tarkista, onko jokainen uusi tilaus käytössä." },
  price: { figure: (e) => `nousu ${e} vuodessa`, todo: "Tarkista, tarvitsetko palvelua tällä hinnalla, ja kilpailuta tai irtisano se." },
  "price-rises": { figure: (e) => `nousu ${e} vuodessa`, todo: "Tarkista, tarvitsetko palveluja näillä hinnoilla, ja kilpailuta tai irtisano ne." },
  renewals: { figure: (e) => `maksaa ${e} vuodessa`, todo: "Tarkista ennen uusiutumista, tarvitsetko tätä yhä." },
  instalments: { figure: (e) => `maksaa ${e} vuodessa`, todo: "Tarkista, milloin erät loppuvat, ennen kuin otat uusia." },
  debt: { figure: (e) => `yli rajan ${e} vuodessa`, todo: "Kilpailuta kallein laina tai neuvottele sen korosta." },
  borrowed: { figure: (e) => `nostettu ${e}`, todo: "Maksa kallein luotto pois ensin." },
  "commitments-share": { figure: (e) => `kasvua ${e} vuodessa`, todo: "Tarkista, mitkä kiinteät menot ovat kasvaneet." },
  "spending-growth": { figure: (e) => `ero ${e} vuodessa`, todo: "Tarkista tapahtumista, mihin ostokset ovat kasvaneet." },
  seasons: { figure: (e) => `lisämenot ${e} vuodessa`, todo: "Varaa rahaa kalliita kuukausia varten etukäteen." },
  "spending-groceries": { figure: (e) => `muutos ${e} vuodessa`, todo: null },
};

const STOPPED_FREED: Reading = { figure: (e) => `vapautui ${e} vuodessa`, todo: "Siirrä vapautunut summa säästöön." };
const STOPPED_QUIET: Reading = { figure: (e) => `maksoi ${e} vuodessa`, todo: "Tarkista, loppuiko maksu tarkoituksella." };
const PLAIN: Reading = { figure: (e) => `${e} vuodessa`, todo: null };

function readingOf(i: Pick<Insight, "id" | "tone">): Reading {
  const kind = i.id.split(":")[0]!;
  if (kind === "stopped") return i.tone === "good" ? STOPPED_FREED : STOPPED_QUIET;
  return READINGS[kind] ?? PLAIN;
}

/** The figure in words, lower case: "maksaa 276 € vuodessa". Päätetyt says it as the card did. */
export const insightFigure = (i: Pick<Insight, "id" | "tone" | "direction" | "yearlyCents">) => readingOf(i).figure(figureOf(i));

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function OtherCard({ insight: i, onChanged }: { insight: Insight; onChanged: Changed }) {
  const titleId = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { todo } = readingOf(i);
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
    <article className="other" aria-labelledby={titleId}>
      <div className="finding-top">
        <div className="finding-main">
          <span className={`badge other-tone ${TONE_BADGE[i.tone]}`}>{TONE[i.tone]}</span>
          <p className="finding-title" id={titleId}>
            {i.title}
          </p>
          {todo && <p className="other-todo">{todo}</p>}
        </div>
        <div className="finding-money">
          <span className="other-figure">{capital(insightFigure(i))}</span>
        </div>
      </div>
      <div className="finding-actions">
        <div className="form-row">
          {i.link && (
            <a className="btn btn-small" href={`#/transactions${query({ ...i.link })}`} aria-describedby={titleId}>
              Näytä tapahtumat
            </a>
          )}
          <button className="btn btn-small" type="button" disabled={busy} aria-busy={busy || undefined} aria-describedby={titleId} onClick={dismiss}>
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
    <Section id="muut-havainnot" title="Muut havainnot">
      <div className="findings">
        {others.map((i) => (
          <OtherCard key={i.id} insight={i} onChanged={onChanged} />
        ))}
      </div>
    </Section>
  );
}
