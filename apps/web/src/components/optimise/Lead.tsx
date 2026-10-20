/**
 * The top of Säästövinkit: four answers before any list. What the tips are worth a year, what the decisions already
 * saved, the next day to decide by and how much was looked at. Every euro is a server field; the web counts checks and
 * days only, and a tile whose field is missing is not drawn.
 */
import { Estimate } from "../Why.tsx";
import { addDays, type Check, type OptimiseData, type FollowUp } from "@banking/core";
import { dayMonth, money, plural } from "../../format.ts";
import { Figure } from "../Figure.tsx";
import { nameOf, rangeText } from "./shared.tsx";
import { NEAR_DAYS } from "./Tips.tsx";

/** The days the deadline strip covers, as Seuraavat 60 päivää does. */
const SOON_DAYS = 60;

type Kind = "finding" | "clear" | "waiting" | "none";
const KIND_OF: Record<Check["status"], Kind> = { finding: "finding", clear: "clear", needs_input: "waiting", no_data: "waiting", no_rows: "none", no_subject: "none" };

/** The checks of every area by what became of them: the segments of the Tarkistettu tile and of the Tarkistettu panel. */
export function checkCounts(data: Pick<OptimiseData, "areas">): Record<Kind, number> {
  const n: Record<Kind, number> = { finding: 0, clear: 0, waiting: 0, none: 0 };
  for (const a of data.areas) for (const c of a.checks) n[KIND_OF[c.status]]++;
  return n;
}

/** What each segment counts, in the order the bar draws them. */
const SEGMENT_WORD: Record<Kind, (n: number) => string> = {
  finding: (n) => plural(n, "vinkki", "vinkkiä"),
  clear: (n) => `${n} kunnossa`,
  waiting: (n) => `${n} vailla tietoja`,
  none: (n) => `${n} ei tarkistettavaa`,
};

/** The checks as segments; `labelled` puts each segment's count and word under the bar, so the bar reads at any width. */
export function CheckSegments({ counts, labelled = false }: { counts: Record<Kind, number>; labelled?: boolean }) {
  const total = counts.finding + counts.clear + counts.waiting + counts.none;
  if (!total) return null;
  const kinds = (["finding", "clear", "waiting", "none"] as const).filter((k) => counts[k] > 0);
  return (
    <>
      <span className="check-seg" aria-hidden="true">
        {kinds.map((k) => (
          <span key={k} className={`seg-${k}`} style={{ flexGrow: counts[k] }} />
        ))}
      </span>
      {labelled && (
        <ul className="check-key">
          {kinds.map((k) => (
            <li key={k}>
              <span className={`check-swatch seg-${k}`} aria-hidden="true" />
              {SEGMENT_WORD[k](counts[k])}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

export function Lead({ data, followUp, confirmedCount, title }: { data: OptimiseData; followUp: FollowUp; confirmedCount: number; title: (id: string) => string }) {
  const { headline, soon, today } = data;
  // the tips the headline leaves out (shared, overlapping, matala or a deadline only) are named, so the counts never look apart
  const shown = data.areas.reduce((n, a) => n + a.findings.length, 0);
  const apart = Math.max(0, shown - headline.count);
  const range = headline.count ? rangeText(headline) : null;
  const last = followUp.line.at(-1) ?? null;
  const next = soon.find((f) => f.decideBy) ?? null;
  const counts = checkCounts(data);
  const total = counts.finding + counts.clear + counts.waiting + counts.none;
  const days = new Set(soon.flatMap((f) => (f.decideBy ? [f.decideBy] : [])));
  return (
    <section className="key-figures sv-lead" aria-label="Säästövinkit lyhyesti">
      <div className="kf">
        <div className="kf-label">Säästö vuodessa, arvio</div>
        <div className="kf-row">
          {headline.count > 0 ? (
            <span className="est">
              <Estimate>
                <Figure text={money(headline.midCents, false)} size="l" />
              </Estimate>
            </span>
          ) : (
            <Figure text={money(0, false)} size="l" />
          )}
        </div>
        <div className="kf-sub">
          {range && `${range} · `}
          {headline.count ? `${plural(headline.count, "vinkki", "vinkkiä")} laskettu yhteen${apart ? `, ${apart} erikseen` : ""}` : "Ei vinkkejä nyt"}
        </div>
      </div>
      {/* a tile shows only with something to say: a confirmed saving, a day to decide by */}
      {last && confirmedCount > 0 && (
        <div className="kf">
          <div className="kf-label">Vahvistettu säästö</div>
          <Figure text={money(last.confirmedCents, false)} size="l" />
          <div className="kf-sub">Vuodessa, {plural(confirmedCount, "muutos", "muutosta")} vahvistui</div>
        </div>
      )}
      {next?.decideBy && (
        <div className="kf">
          <div className="kf-label">Seuraava määräpäivä</div>
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
      {total > 0 && (
        <div className="kf">
          <div className="kf-label">Tarkistettu</div>
          <Figure text={`${total} asiaa`} size="l" whole />
          <CheckSegments counts={counts} />
          <div className="kf-sub">
            {plural(counts.finding, "vinkki", "vinkkiä")} · {counts.clear} kunnossa · {counts.waiting} vailla tietoja
          </div>
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
