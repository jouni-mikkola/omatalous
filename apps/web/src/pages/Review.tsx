/**
 * Decision: the household settles, one at a time, what the app cannot settle itself: what a payee is, whose money came
 * to a shared account, whether a payment is a loan, whether a subscription is still used. Every figure on the other pages
 * gets truer with each answer, so this is the one place that asks; no other page shows a question card.
 *
 * One item at a time, the most money first: what it is (mark, sum, date, the rows behind it on tap), the app's guess
 * first, the choices as large buttons, Ohita for later. An answer goes through the source's own route and the next item
 * shows at once. After `SITTING` items the page says it is enough for now.
 */
import { useEffect, useRef, useState } from "react";
import { api } from "../api.ts";
import { logoForInstitution } from "../banks.ts";
import { BankLogo } from "../components/BankLogo.tsx";
import { Figure } from "../components/Figure.tsx";
import { MarkCell } from "../components/table/Cells.tsx";
import { date, money } from "../format.ts";
import { publishReviewCount } from "../review-count.ts";
import type { Meta } from "../types.ts";
import { eyebrow, figureOf, isPerson, leftText, nameOf, NEW_SITTING, openItems, questionOf, type ReviewAnswer, type ReviewItem, type Sitting, sittingView } from "./review-items.ts";
import { ChoiceButton, Choices } from "./ReviewChoices.tsx";
import "../styles/review.css";
import "../styles/why.css";
import { Button } from "../components/ui/Button.tsx";
import { Notice } from "../components/ui/Notice.tsx";
import { ErrorCard } from "../components/ErrorCard.tsx";
import { Empty } from "../components/ui/Empty.tsx";
import { CONNECT_BANK_HASH } from "../routes.ts";
import { t } from "../text.ts";
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
  // counts the moves to the next item; the focus follows in an effect, after the new card is in the page
  const [moved, setMoved] = useState(0);
  // the header's mark and the page's heading say the number the queue below does, an answer included
  const left = queue.data ? openItems(queue.data.items, sitting).length : undefined;
  useEffect(() => {
    if (left !== undefined) publishReviewCount(left);
  }, [left]);
  useEffect(() => {
    if (moved > 0) heading.current?.focus();
  }, [moved]);

  if (!queue.data) {
    return queue.error ? (
      <ErrorCard message={queue.error} onRetry={queue.reload} />
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
    setMoved((n) => n + 1);
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
      {view.state === "enough" && <End title={t("set.rv.this_batch_of_questions_is")} text={leftText(view.left)} heading={heading} />}
      {view.state === "skipped" && <End title={t("set.rv.the_rest_are_waiting")} text={leftText(view.left)} heading={heading} />}
      {view.state === "empty" &&
        (meta.accounts.length === 0 && meta.sharedAccounts.length === 0 ? (
          <End
            title={t("set.rv.nothing_to_review_yet")}
            text={t("set.rv.questions_appear_here_once_a")}
            heading={heading}
            action={{ href: CONNECT_BANK_HASH, label: t("set.rv.connect_bank") }}
            done={false}
          />
        ) : (
          <End title={t("set.rv.nothing_to_ask")} text={t("set.rv.new_questions_come_when_the")} heading={heading} />
        ))}
    </div>
  );
}

function End({ title, text, heading, action = { href: "#/overview", label: t("set.rv.go_to_summary") }, done = true }: { title: string; text: string; heading: React.RefObject<HTMLHeadingElement | null>; action?: { href: string; label: string }; done?: boolean }) {
  return (
    // the tick means the queue was gone through: a first run with nothing to read has none
    <Empty className="review-end" title={title} headingRef={heading} mark={done ? <span className="review-done-mark" aria-hidden="true" /> : undefined} action={<Button href={action.href}>{action.label}</Button>}>
      <p>{text}</p>
    </Empty>
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
          <span className="sr-only"> {all ? t("set.rv.hide_rows", { name }) : t("set.rv.show_rows", { name })}</span>
        </button>
      ) : (
        <div className="review-figure">{value}</div>
      )}
      <p className="review-line">{figure.line}</p>
      {shown.length > 0 && (
        <ul className="review-row-list" aria-label={t("set.rv.latest_transactions_name", { name })}>
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
      {all && (item.rowCount ?? 0) > own.length && <p className="review-note">{t("set.rv.newest_of", { shown: own.length, total: item.rowCount ?? 0 })}</p>}

      <h2 id="review-q" className="review-q" ref={heading} tabIndex={-1}>
        {questionOf(item)}
      </h2>
      <Choices item={item} meta={meta} busy={busy} onAnswer={onAnswer} />
      {item.kind === "payer" && <p className="review-note">{t("set.rv.the_answer_also_covers_earlier")}</p>}
      {problem && (
        <Notice tone="error" className="review-error" as="p">
          {problem}
        </Notice>
      )}
      <div className="review-later">
        {(item.kind === "payee_out" || item.kind === "payee_in") && (
          <ChoiceButton className="review-skip" busy={busy} onClick={() => onAnswer(() => api("/api/marks", { method: "PUT", body: { subject: `question:payee:${item.merchant}`, mark: "dismissed" } }))}>
            {t("set.rv.do_not_ask_about_this")}
          </ChoiceButton>
        )}
        <button className="review-skip" type="button" disabled={busy} onClick={onSkip}>
          {t("set.rv.skip_ask_later")}
        </button>
      </div>
    </section>
  );
}

/** The rows the card shows at once; the figure opens the rest the server sent. */
const NEWEST_ROWS = 3;
