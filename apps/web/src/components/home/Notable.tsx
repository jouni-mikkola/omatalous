// Decision: which of the findings to act on first, and what each is worth a year
import { type Insight, insightEuros, insightText, insightUnit } from "@banking/core";
import { targetHref } from "../optimise/Others.tsx";
import { language } from "../../format.ts";
import { t } from "../../text.ts";
import { insightView, Opened } from "../../view-opens.tsx";

/**
 * Huomioitavaa: the findings of the dashboard (Säästövinkit holds the rest), three at most, each as its fact, the
 * comparison it stands on, the one place to go and what it is worth a year. The fact, the comparison and the euros are the
 * insight's own words (`insightText`); nothing is composed here.
 */
export function Notable({ insights }: { insights: readonly Insight[] }) {
  return (
    <section className="card home-notable" aria-labelledby="home-notable-h">
      <Opened views={insights.map((i) => insightView(i.id))} />
      <h2 id="home-notable-h">{t("home.notable")}</h2>
      {insights.length === 0 ? (
        <p className="home-detail">{t("home.notable_none")}</p>
      ) : (
        <ul className="home-notes">
          {insights.map((i) => {
            const text = insightText(i, language());
            return (
              <li key={i.id} className="home-note">
                <div className="home-note-text">
                  <p className="home-note-title">{text.title}</p>
                  <p className="home-detail">{text.comparison}</p>
                  <p className="home-note-action">
                    <a href={targetHref(i.action.target)}>{text.action}</a>
                  </p>
                </div>
                <p className="home-note-effect">
                  <span className="num">{insightEuros(i, language())}</span>
                  <small>{insightUnit(i, language())}</small>
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
