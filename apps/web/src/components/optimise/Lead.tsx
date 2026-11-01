/**
 * The top of Säästövinkit: up to three answers before any list. What the tips are worth a year, what the decisions
 * already saved and the next day to decide by. Every euro is a server field; the web counts
 * days only, and a tile whose field is missing is not drawn.
 */
import { Estimate } from "../Why.tsx";
import { addDays, type OptimiseData, type FollowUp } from "@banking/core";
import { dayMonth, money } from "../../format.ts";
import { t, tn } from "../../text.ts";
import { Figure } from "../Figure.tsx";
import { nameOf, rangeText } from "./shared.tsx";
import { NEAR_DAYS } from "./Tips.tsx";

/** The days the deadline strip covers, as Seuraavat 60 päivää does. */
const SOON_DAYS = 60;

export function Lead({ data, followUp, confirmedCount, title }: { data: OptimiseData; followUp: FollowUp; confirmedCount: number; title: (id: string) => string }) {
  const { headline, soon, today } = data;
  // the tips the headline leaves out (shared, overlapping, matala or a deadline only) are named, so the counts never look apart
  const shown = data.areas.reduce((n, a) => n + a.findings.length, 0);
  const apart = Math.max(0, shown - headline.count);
  const range = headline.count ? rangeText(headline) : null;
  const last = followUp.line.at(-1) ?? null;
  const next = soon.find((f) => f.decideBy) ?? null;
  const days = new Set(soon.flatMap((f) => (f.decideBy ? [f.decideBy] : [])));
  return (
    <section className="key-figures sv-lead" aria-label={t("ow.ld_aria")}>
      <div className="kf">
        <div className="kf-label">{t("ow.ld_est")}</div>
        <div className="kf-row">
          {/* no tips, no sum: a zero would read as a finding that nothing can be saved */}
          {headline.count > 0 && (
            <span className="est">
              <Estimate>
                <Figure text={money(headline.midCents, false)} size="l" />
              </Estimate>
            </span>
          )}
        </div>
        <div className="kf-sub">
          {range && `${range} · `}
          {headline.count ? t(apart ? "ow.ld_counted_apart" : "ow.ld_counted", { tips: tn(headline.count, "ow.cnt_finding_one", "ow.cnt_finding_many"), apart }) : t("ow.ld_none")}
        </div>
      </div>
      {/* a tile shows only with something to say: a confirmed saving, a day to decide by */}
      {last && confirmedCount > 0 && (
        <div className="kf">
          <div className="kf-label">{t("ow.ld_conf")}</div>
          <Figure text={money(last.confirmedCents, false)} size="l" />
          <div className="kf-sub">{tn(confirmedCount, "ow.ld_conf_one", "ow.ld_conf_many")}</div>
        </div>
      )}
      {next?.decideBy && (
        <div className="kf">
          <div className="kf-label">{t("ow.ld_next")}</div>
          <span className="fig fig-l">{dayMonth(next.decideBy)}</span>
          <span className="kf-days" aria-hidden="true">
            {Array.from({ length: SOON_DAYS + 1 }, (_, i) => {
              const day = addDays(today, i);
              return <span key={i} className={`kf-day${i === 0 ? " kf-today" : ""}${days.has(day) ? ` kf-due${i < NEAR_DAYS ? " kf-near" : ""}` : ""}`} />;
            })}
          </span>
          <div className="kf-sub">{title(next.id)}</div>
        </div>
      )}
    </section>
  );
}

/** The name of a finding for the deadline tile: the page's title map when it has one, else the area and merchant. */
export const titleOf = (titles: ReadonlyMap<string, string>, data: OptimiseData) => (id: string) => {
  const named = nameOf(id, data.areas);
  return named.length < (titles.get(id)?.length ?? Infinity) ? named : (titles.get(id) ?? named);
};
