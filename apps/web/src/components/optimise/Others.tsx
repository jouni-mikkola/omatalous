/**
 * Muut havainnot: the insights no finding covers, each a card of the tips' kind with its figure and one key, Ei koske
 * meitä. They are not savings: the figure says what it is (a cost, a rise, a sum drawn) apart from the tips' euros, and
 * the figure opens its rows in Tapahtumat.
 */
import { type Insight, insightDismissSubject, QUESTIONS, insightEuros, insightReading, insightText, insightUnit, } from "@banking/core";
import { language } from "../../format.ts";
import { t } from "../../text.ts";
import { useId, useState } from "react";
import { api, query } from "../../api.ts";
import { Section } from "../Section.tsx";
import { Figure } from "../Figure.tsx";
import type { Changed } from "./shared.tsx";
import { Button } from "../ui/Button.tsx";
import { insightView, Opened } from "../../view-opens.tsx";
/** The figure in words, lower case: "maksaa 276 € vuodessa". Päätetyt says it as the card did. */
export const insightFigure = (i: Insight) => insightReading(i, language());

/** Where the action of an insight opens: the rows, the bills or a report section. */
export function targetHref(target: Insight["action"]["target"]): string {
  if (target.page === "transactions") return `#/transactions${query({ ...target.filter })}`;
  if (target.page === "bills") return "#/bills";
  // an anchor starts with the question that holds it ("kiinteat-hinnat"), so the link opens that page first
  const question = QUESTIONS.find((q) => target.anchor === q || target.anchor.startsWith(`${q}-`));
  return `#/reports${question ? `?q=${question}` : ""}#${target.anchor}`;
}

/** Lines of working shown open; a longer working folds behind Laskelma so the card stays short on a phone. */
const OPEN_CALC_LINES = 3;

/** The working as Laskelma draws it in a finding (Evidence.tsx): each figure with its name, on one line. */
function CalcLines({ calc }: { calc: Insight["evidence"]["calc"] }) {
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
      <summary>{t("ow.ev_calc")}</summary>
      {line}
    </details>
  );
}

function OtherCard({ insight: i, onChanged }: { insight: Insight; onChanged: Changed }) {
  const titleId = useId();
  const text = insightText(i, language());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // the mark holds the figure, so the insight returns when it moves 25 % (core's rule)
  const dismiss = () => {
    setBusy(true);
    setError(null);
    api("/api/marks", { method: "PUT", body: { subject: insightDismissSubject(i), mark: "dismissed" } })
      .then(() => onChanged(t("ow.ot_moved")))
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(false));
  };
  const figure = (
    <>
      <span className="tip-fig">
        <Figure text={insightEuros(i, language())} size="m" />
      </span>
      <span className="tip-unit">{insightUnit(i, language())}</span>
    </>
  );
  return (
    <article className="tip other" aria-labelledby={titleId}>
      <div className="tip-main">
        <div className="other-head">
          <p className="tip-title" id={titleId}>
            {text.title}
          </p>
        </div>
        <p className="tip-action">
          {text.comparison} <a href={targetHref(i.action.target)}>{text.action}</a>
        </p>
        {i.evidence.calc.length > 0 && <CalcLines calc={i.evidence.calc} />}
      </div>
      {/* the figure opens its rows: its name is the figure as seen plus a hidden "Näytä tapahtumat" (the name must hold the visible text), the title is its description */}
      {i.evidence.link ? (
        <a className="tip-figure" href={`#/transactions${query({ ...i.evidence.link })}`} aria-describedby={titleId}>
          {figure}
          <span className="sr-only">{`. ${t("ow.ot_show_rows")}`}</span>
        </a>
      ) : (
        <div className="tip-figure tip-figure-still">{figure}</div>
      )}
      <div className="tip-actions">
        <div className="finding-actions">
          <Button variant="link" className="decide-key" busy={busy} aria-describedby={titleId} onClick={dismiss}>
            {t("ow.ot_dismiss")}
          </Button>
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
    <Section id="muut-havainnot" title={t("ow.ot_title")} half={half}>
      <Opened views={others.map((i) => insightView(i.id))} />
      <div className="tips">
        {others.map((i) => (
          <OtherCard key={i.id} insight={i} onChanged={onChanged} />
        ))}
      </div>
    </Section>
  );
}
