/**
 * Decision: what to do about each tip: change it, set it aside or be reminded later.
 * The tips with a day to decide by come first, on a 60-day line; the rest follow grouped by area, each group headed by
 * its mark, its count and the area's saving. A tip's figure opens its calculation and rows: no key with words for it.
 */
import { Estimate } from "../Why.tsx";
import { addDays, type AreaView, type Finding, type IsoDate } from "@banking/core";
import { useId, useState } from "react";
import { date, dayMonth, money } from "../../format.ts";
import type { Scope } from "../../types.ts";
import { Figure } from "../Figure.tsx";
import { Section } from "../Section.tsx";
import { Evidence } from "./Evidence.tsx";
import { FindingActions } from "./FindingActions.tsx";
import { AreaMark, CertaintySteps } from "./marks.tsx";
import { type Changed, rangeText } from "./shared.tsx";

const SOON_DAYS = 60;
/** A deadline this near, or one past, wears the warn status; a later one is a quiet pin. */
export const NEAR_DAYS = 30;

/** Days from `from` to `to`, both ISO dates (UTC midnights, so no clock is read). */
const daysBetween = (from: IsoDate, to: IsoDate) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

export function TipCard({ finding: f, today, scope, onChanged }: { finding: Finding; today: IsoDate; scope: Scope; onChanged: Changed }) {
  const titleId = useId();
  const [open, setOpen] = useState(false);
  const range = f.euros ? rangeText(f.euros) : null;
  // only an estimate wears ≈: a range, or a figure the certainty marks down; a price rise read off the rows is exact
  const estimate = range !== null || f.certainty.level !== "korkea";
  const left = f.decideBy ? daysBetween(today, f.decideBy) : null;
  const label = `Laskelma: ${f.euros ? `${estimate ? "arviolta " : ""}${money(f.euros.midCents, false)} vuodessa` : `määräpäivä ${date(f.decideBy)}`}`;
  const chevron = (
    <svg className="tip-chev" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
      <path d="M4 6l4 4 4-4" />
    </svg>
  );
  // an exact figure the title already says is said once: the title's own figure opens the basis
  const said = f.euros && !estimate ? money(f.euros.midCents, false) : null;
  const at = said ? f.title.indexOf(said) : -1;
  const title =
    at >= 0 ? (
      <>
        {f.title.slice(0, at)}
        <button className="tip-inline why-fig" type="button" aria-expanded={open} aria-label={label} onClick={() => setOpen((o) => !o)}>
          {said}
          {chevron}
        </button>
        {f.title.slice(at + said!.length)}
      </>
    ) : (
      f.title
    );
  return (
    <article className={`tip${open ? " tip-open" : ""}${at >= 0 ? " tip-said" : ""}`} aria-labelledby={titleId}>
      <AreaMark id={f.area} size={32} />
      <div className="tip-main">
        <p className="tip-title" id={titleId}>
          {title}
        </p>
        <p className="tip-action">{f.action}</p>
        <p className="tip-meta">
          {/* the certainty is told only when it is not high */}
          {f.certainty.level !== "korkea" && (
            <>
              <CertaintySteps level={f.certainty.level} />
              <span className="tip-reason">{f.certainty.reason}</span>
            </>
          )}
          {/* a tip of a deadline alone has the day as its figure: the chip would say it again */}
          {f.decideBy && f.euros && (
            <span className={`tip-due${left !== null && left < NEAR_DAYS ? " tip-due-near" : ""}`}>
              <span aria-hidden="true">◷</span> Päätä viimeistään {date(f.decideBy)}
            </span>
          )}
          {f.shared && <span className="tip-shared">Päätetään yhdessä</span>}
          {f.reopened && <span className="badge warn">Palasi, koska arvio nousi</span>}
        </p>
      </div>
      {at < 0 && (
        <button className="tip-figure" type="button" aria-expanded={open} aria-describedby={titleId} onClick={() => setOpen((o) => !o)}>
          {f.euros ? (
            <>
              <span className="tip-fig">
                <Estimate when={estimate}>
                  <Figure text={money(f.euros.midCents, false)} size="m" />
                </Estimate>
              </span>
              <span className="tip-unit">{range ? `vuodessa · ${range}` : "vuodessa"}</span>
            </>
          ) : (
            <>
              <span className="tip-fig">
                <span className="fig fig-m">{dayMonth(f.decideBy!)}</span>
              </span>
              <span className="tip-unit">määräpäivä</span>
            </>
          )}
          <span className="sr-only">, laskelma</span>
          {chevron}
        </button>
      )}
      <div className="tip-actions">
        <FindingActions finding={f} describedBy={titleId} today={today} scope={scope} onChanged={onChanged} />
      </div>
      {open && (
        <div className="tip-basis">
          <Evidence id={f.id} scope={scope} />
        </div>
      )}
    </article>
  );
}

/** The 60 days ahead as a line, today at the left, a labelled pin on each day a tip must be decided by. */
function DueLine({ soon, today, short }: { soon: readonly Finding[]; today: IsoDate; short: (f: Finding) => string }) {
  const pins = soon.filter((f) => f.decideBy).map((f) => ({ f, at: Math.min(SOON_DAYS, Math.max(0, daysBetween(today, f.decideBy!))) }));
  const ticks = [0, 15, 30, 45, 60];
  return (
    <div className="due-line" aria-hidden="true">
      <div className="due-axis">
        {ticks.map((t) => (
          <span key={t} className="due-tick" style={{ insetInlineStart: `${(t / SOON_DAYS) * 100}%` }}>
            <span>{t === 0 ? "Tänään" : dayMonth(addDays(today, t))}</span>
          </span>
        ))}
      </div>
      {pins.map(({ f, at }, i) => (
        <span key={f.id} className={`due-pin due-row-${i % 3}${daysBetween(today, f.decideBy!) < NEAR_DAYS ? " due-near" : ""}`} style={{ insetInlineStart: `${(at / SOON_DAYS) * 100}%` }}>
          <span className="due-pin-label">
            <strong>{dayMonth(f.decideBy!)}</strong> <span className="due-pin-name">{short(f)}</span>
          </span>
        </span>
      ))}
    </div>
  );
}

export function Soon({ soon, today, scope, onChanged, short }: { soon: readonly Finding[]; today: IsoDate; scope: Scope; onChanged: Changed; short: (f: Finding) => string }) {
  if (!soon.length) return null;
  const first = soon[0]!;
  const left = first.decideBy ? daysBetween(today, first.decideBy) : null;
  return (
    <Section id="seuraavat" title="Mitä pitää päättää 60 päivän sisällä?" sub={left !== null ? `${left} päivää ensimmäiseen määräpäivään.` : undefined}>
      <DueLine soon={soon} today={today} short={short} />
      <div className="tips">
        {soon.map((f) => (
          <TipCard key={f.id} finding={f} today={today} scope={scope} onChanged={onChanged} />
        ))}
      </div>
    </Section>
  );
}

/** Tips a group shows before Näytä lisää. */
const SHOWN = 3;

function Group({ area, above, today, scope, onChanged }: { area: AreaView; above: ReadonlySet<string>; today: IsoDate; scope: Scope; onChanged: Changed }) {
  const [all, setAll] = useState(false);
  const here = area.findings.filter((f) => !above.has(f.id));
  if (!here.length) return null;
  const shown = all ? here : here.slice(0, SHOWN);
  return (
    <div className="tip-group" id={`alue-${area.id}`}>
      <h3 className="tip-group-head">
        <AreaMark id={area.id} size={24} />
        <span>{area.label}</span>
        <span className="rt-group-count">{here.length}</span>
      </h3>
      <div className="tips">
        {shown.map((f) => (
          <TipCard key={f.id} finding={f} today={today} scope={scope} onChanged={onChanged} />
        ))}
      </div>
      {here.length > SHOWN && (
        <button className="btn btn-small tips-more" type="button" onClick={() => setAll((v) => !v)} aria-expanded={all}>
          {all ? "Näytä vähemmän" : `Näytä kaikki ${here.length}`}
        </button>
      )}
      {area.summary && (
        <dl className="calc tip-summary" aria-label={area.summary.title}>
          {area.summary.lines.map((l, i) => (
            <div key={i}>
              <dt>{l.label}</dt>
              <dd>{l.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

export function Tips({ areas, above, today, scope, onChanged }: { areas: readonly AreaView[]; above: ReadonlySet<string>; today: IsoDate; scope: Scope; onChanged: Changed }) {
  const groups = areas.filter((a) => a.findings.some((f) => !above.has(f.id)));
  if (!groups.length) return null;
  return (
    <Section id="vinkit" title="Vinkit alueittain">
      <div className="tip-groups">
        {groups.map((a) => (
          <Group key={a.id} area={a} above={above} today={today} scope={scope} onChanged={onChanged} />
        ))}
      </div>
    </Section>
  );
}
