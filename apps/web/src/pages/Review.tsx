/**
 * Decision: the household settles, one at a time, what the app cannot settle itself: what a payee is, whose money came
 * to a shared account, whether a payment is a loan, whether a subscription is still used. Every figure on the other pages
 * gets truer with each answer, so this is the one place that asks; no other page shows a question card.
 *
 * One item at a time, the most money first: what it is (mark, sum, date, the rows behind it on tap), the app's guess
 * first, the choices as large buttons, Ohita for later. An answer goes through the source's own route and the next item
 * shows at once. After `SITTING` items the page says it is enough for now.
 */
import { useRef, useState } from "react";
import { api } from "../api.ts";
import { logoForInstitution } from "../banks.ts";
import { BankLogo } from "../components/BankLogo.tsx";
import { Figure } from "../components/Figure.tsx";
import { MarkCell } from "../components/table/Cells.tsx";
import { date, money } from "../format.ts";
import type { Meta } from "../types.ts";
import { eyebrow, figureOf, isPerson, leftText, nameOf, NEW_SITTING, questionOf, type ReviewAnswer, type ReviewItem, type Sitting, sittingView } from "./review-items.ts";
import { ChoiceButton, Choices } from "./ReviewChoices.tsx";
import "../styles/review.css";
import "../styles/why.css";

interface Queue {
  data: ReviewAnswer | null;
  error: string | null;
  reload: () => void;
}

export function Review({ meta, queue }: { meta: Meta; queue: Queue }) {
  const [sitting, setSitting] = useState<Sitting>(NEW_SITTING);
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);

  if (!queue.data) {
    return queue.error ? (
      <div className="card error" role="alert">
        <p>{queue.error}</p>
        <button className="btn" type="button" onClick={queue.reload}>
          Yritä uudelleen
        </button>
      </div>
    ) : (
      <div className="review" aria-busy="true">
        <div className="card review-item review-skeleton" />
      </div>
    );
  }

  const view = sittingView(queue.data.items, sitting);
  const next = (change: (s: Sitting) => Sitting) => {
    setProblem(null);
    setSitting(change);
    // the next item takes the place of the last: the reader's place moves to its question
    requestAnimationFrame(() => heading.current?.focus());
  };
  const answer = async (item: ReviewItem, send: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(item.id);
    setProblem(null);
    try {
      await send();
      next((s) => ({ ...s, answered: [...s.answered, item.id] }));
      queue.reload();
    } catch (err) {
      setProblem((err as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const skip = (item: ReviewItem) => next((s) => ({ ...s, skipped: [...s.skipped, item.id] }));

  return (
    <div className="review">
      {view.state === "item" && (
        <>
          {/* the sitting: what is left of it, and a track of how far it has gone; an answer and Ohita move both */}
          <header className="review-head">
            <p className="review-datum">
              <Figure text={String(view.of - view.position + 1)} size="m" whole /> jäljellä{view.open > view.of ? " tällä kerralla" : ""}
            </p>
            <div className="review-progress" role="progressbar" aria-label="Tämä kerta" aria-valuemin={0} aria-valuemax={view.of} aria-valuenow={view.position - 1}>
              <span style={{ width: `${(100 * (view.position - 1)) / view.of}%` }} />
            </div>
          </header>
          <ItemCard
            key={view.item.id}
            item={view.item}
            meta={meta}
            heading={heading}
            busy={busy !== null}
            waiting={busy === view.item.id}
            problem={problem}
            onAnswer={(send) => void answer(view.item, send)}
            onSkip={() => skip(view.item)}
          />
        </>
      )}
      {view.state === "enough" && <End title="Riittää tältä kertaa" text={leftText(view.left)} heading={heading} />}
      {view.state === "skipped" && <End title="Loput ohitettu" text={leftText(view.left)} heading={heading} />}
      {view.state === "empty" &&
        (meta.accounts.length === 0 && meta.sharedAccounts.length === 0 ? (
          <End
            title="Ei vielä tarkistettavaa"
            text="Kysymykset tulevat tänne, kun pankki on yhdistetty ja tapahtumat on haettu. Sovellus kysyy vain sitä, mitä se ei osaa päätellä itse."
            heading={heading}
            action={{ href: "#/settings?add=1", label: "Yhdistä pankki" }}
            done={false}
          />
        ) : (
          <End title="Kaikki tarkistettu" text="Uusia tarkistettavia tulee, kun pankista tulee uusia tapahtumia." heading={heading} />
        ))}
    </div>
  );
}

function End({ title, text, heading, action = { href: "#/overview", label: "Yhteenvetoon" }, done = true }: { title: string; text: string; heading: React.RefObject<HTMLHeadingElement | null>; action?: { href: string; label: string }; done?: boolean }) {
  return (
    <section className="card empty-card review-end" aria-labelledby="review-end-h">
      {/* the tick means the queue was gone through: a first run with nothing to read has none */}
      {done && <span className="review-done-mark" aria-hidden="true" />}
      <h2 id="review-end-h" ref={heading} tabIndex={-1}>
        {title}
      </h2>
      <p>{text}</p>
      <a className="btn" href={action.href}>
        {action.label}
      </a>
    </section>
  );
}

interface CardProps {
  item: ReviewItem;
  meta: Meta;
  heading: React.RefObject<HTMLHeadingElement | null>;
  busy: boolean;
  waiting: boolean;
  problem: string | null;
  onAnswer: (send: () => Promise<unknown>) => void;
  onSkip: () => void;
}

function ItemCard({ item, meta, heading, busy, waiting, problem, onAnswer, onSkip }: CardProps) {
  const figure = figureOf(item);
  const name = nameOf(item);
  const [all, setAll] = useState(false);
  // the item's own rows as the server picked them: nothing is filtered or added here
  const own = item.rows ?? [];
  const shown = all ? own : own.slice(0, NEWEST_ROWS);
  const logo = item.kind === "loan" || item.kind === "plan" ? logoForInstitution(item.payee, meta.bank.banks) : null;
  const value = (
    <>
      <Figure text={figure.text} size="l" />
      {figure.unit && (
        <>
          {" "}
          <span className="review-unit">{figure.unit}</span>
        </>
      )}
    </>
  );
  return (
    <section className="card review-item" aria-labelledby="review-q" aria-busy={waiting || undefined}>
      <span className="review-kind">{eyebrow(item)}</span>
      <div className="review-who">
        <MarkCell name={name} mark={logo ? <BankLogo src={logo} name={name} size="sm" /> : undefined} person={isPerson(item) || undefined} size="l">
          <span className="review-name">{name}</span>
        </MarkCell>
      </div>
      {/* the figure opens its rows: the name is the figure as seen plus a hidden action (the name must hold the visible text) */}
      {!figure.text ? null : own.length > NEWEST_ROWS ? (
        <button className="why-fig review-figure" type="button" aria-expanded={all} onClick={() => setAll(!all)}>
          {value}
          <span className="sr-only">{`, ${all ? "piilota" : "näytä"} tapahtumat: ${name}`}</span>
        </button>
      ) : (
        <div className="review-figure">{value}</div>
      )}
      <p className="review-line">{figure.line}</p>
      {shown.length > 0 && (
        <ul className="review-row-list" aria-label={`Viimeisimmät tapahtumat: ${name}`}>
          {shown.map((r) => (
            <li key={r.id}>
              <span className="review-row-date">{date(r.date)}</span>
              <span className="review-row-who">
                <span className="review-row-name">{r.name}</span>
                {r.text && <span className="review-row-text">{r.text}</span>}
              </span>
              <span className="review-row-sum">{money(r.cents)}</span>
            </li>
          ))}
        </ul>
      )}
      {all && (item.rowCount ?? 0) > own.length && <p className="review-note">{`${own.length} uusinta ${item.rowCount} tapahtumasta`}</p>}

      <h2 id="review-q" className="review-q" ref={heading} tabIndex={-1}>
        {questionOf(item)}
      </h2>
      <Choices item={item} meta={meta} busy={busy} onAnswer={onAnswer} />
      {item.kind === "payer" && <p className="review-note">Vastaus koskee myös aiempia kuukausia. Tavallisesta selvästi poikkeavia maksuja se ei muuta.</p>}
      {problem && (
        <p className="error review-error" role="alert">
          {problem}
        </p>
      )}
      <div className="review-later">
        {(item.kind === "payee_out" || item.kind === "payee_in") && (
          <ChoiceButton className="review-skip" busy={busy} onClick={() => onAnswer(() => api("/api/marks", { method: "PUT", body: { subject: `question:payee:${item.merchant}`, mark: "dismissed" } }))}>
            Älä kysy enää
          </ChoiceButton>
        )}
        <button className="review-skip" type="button" disabled={busy} onClick={onSkip}>
          Ohita
        </button>
      </div>
    </section>
  );
}

/** The rows the card shows at once; the figure opens the rest the server sent. */
const NEWEST_ROWS = 3;
