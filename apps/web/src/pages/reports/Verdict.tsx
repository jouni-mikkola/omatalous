// Decision: what to do about the question, from one figure, what it is set beside and the one thing worth doing
import { type CompareKind, type Conclusion, insightText } from "@banking/core";
import { Figure } from "../../components/Figure.tsx";
import { targetHref } from "../../components/optimise/Others.tsx";
import { language, money } from "../../format.ts";
import { insightView, Opened } from "../../view-opens.tsx";
import { t } from "../../text.ts";

/** The figure in the chosen comparison's words, then why it is what it is. */
export function Verdict({ conclusion, kind }: { conclusion: Conclusion; kind: CompareKind | null }) {
  const { figure, comparison } = conclusion.verdict;
  const shown = (kind && conclusion.compare[kind]) || comparison;
  return (
    <div className="verdict">
      <p className="verdict-line">
        <span className="verdict-label">{figure.label}</span>
        <Figure text={money(figure.cents, false)} size="l" />
        {shown && <span className="verdict-vs">{shown.text}</span>}
      </p>
      {conclusion.explanation && <p className="verdict-why">{conclusion.explanation}</p>}
    </div>
  );
}

/** An insight title as the first sentence of the line: the titles carry no full stop, so one is added unless a mark ends it. */
const sentenceTitle = (title: string): string => {
  const t = title.trimEnd();
  return /(?:[.?!:…]|[.?!:…]\))$/.test(t) ? t : `${t}.`;
};

/** The one action core's insights recommend for the page: the insight's sentence and the link its action names. */
export function Recommendation({ conclusion }: { conclusion: Conclusion }) {
  const i = conclusion.recommendation;
  if (!i) return null;
  const text = insightText(i, language());
  return (
    <p className="recommendation">
      <Opened views={[insightView(i.id)]} />
      <strong>{t("rpt.recommendation")}</strong>{" "}
      <span>
        {sentenceTitle(text.title)} {text.effect ? t("rpt.effect", { effect: text.effect }) : ""}
        {text.comparison} <a href={targetHref(i.action.target)}>{text.action}</a>
      </span>
    </p>
  );
}

/** What the figure leaves out, one short line each with its amount, as core counted it (`coverageNotices`). */
export function Notices({ conclusion }: { conclusion: Conclusion }) {
  if (!conclusion.notices.length) return null;
  return (
    <ul className="coverage-notices" aria-label={t("rpt.missing_from_figure")}>
      {conclusion.notices.map((n) => (
        <li key={n.kind} data-notice={n.kind}>
          {n.text}
        </li>
      ))}
    </ul>
  );
}
