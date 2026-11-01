/**
 * Decision: what to do about each tip: change it, set it aside or be reminded later.
 * The tips worth most a year come first, in one list; the ones with a day to decide by within 60 days stand on a line of
 * their own. A tip's figure opens its calculation and rows: no key with words for it.
 */
import { Estimate } from "../Why.tsx";
import { addDays, type AreaId, type AreaView, byYearlyEffect, type Finding, type IsoDate } from "@banking/core";
import { useId, useState } from "react";
import { date, dayMonth, money } from "../../format.ts";
import { t } from "../../text.ts";
import { PRICE_RISES_HASH } from "../../routes.ts";
import type { Scope } from "../../types.ts";
import { Figure } from "../Figure.tsx";
import { Section } from "../Section.tsx";
import { Evidence } from "./Evidence.tsx";
import { FindingActions } from "./FindingActions.tsx";
import { AreaMark, CertaintySteps } from "./marks.tsx";
import { type Changed, rangeText } from "./shared.tsx";
import { Button } from "../ui/Button.tsx";
import { css } from "../../css.ts";
import { findingView, Opened } from "../../view-opens.tsx";
const SOON_DAYS = 60;
/** A deadline this near, or one past, wears the warn status; a later one is a quiet pin. */
export const NEAR_DAYS = 30;

/** Days from `from` to `to`, both ISO dates (UTC midnights, so no clock is read). */
const daysBetween = (from: IsoDate, to: IsoDate) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

export function TipCard({ finding: f, area, today, scope, onChanged }: { finding: Finding; area?: string; today: IsoDate; scope: Scope; onChanged: Changed }) {
  const titleId = useId();
  const [open, setOpen] = useState(false);
  const range = f.euros ? rangeText(f.euros) : null;
  // only an estimate wears ≈: a range, or a figure the certainty marks down; a price rise read off the rows is exact
  const estimate = range !== null || f.certainty.level !== "korkea";
  const left = f.decideBy ? daysBetween(today, f.decideBy) : null;
  const chevron = (
    <svg className="tip-chev" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
      <path d="M4 6l4 4 4-4" />
    </svg>
  );
  return (
    <article className={`tip${open ? " tip-open" : ""}`} aria-labelledby={titleId}>
      <AreaMark id={f.area} size={32} />
      <div className="tip-main">
        <p className="tip-title" id={titleId}>
          {f.title}
        </p>
        <p className="tip-action">
          {f.action}
          {f.area === "subscriptions" && f.kind === "rise" && (
            <>
              {" "}
              <a href={PRICE_RISES_HASH}>{t("ow.tp_rise_calc")}</a>
            </>
          )}
        </p>
        <p className="tip-meta">
          {area && <span className="tip-area">{area}</span>}
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
              {t("ow.tp_decide_by", { date: date(f.decideBy) })}
            </span>
          )}
          {f.shared && <span className="tip-shared">{t("ow.tp_shared")}</span>}
          {f.reopened && <span className="badge warn">{t("ow.tp_reopened")}</span>}
        </p>
      </div>
      <button className="tip-figure" type="button" aria-expanded={open} aria-describedby={titleId} onClick={() => setOpen((o) => !o)}>
        {f.euros ? (
          <>
            <span className="tip-fig">
              <Estimate when={estimate}>
                <Figure text={money(f.euros.midCents, false)} size="m" />
              </Estimate>
            </span>
            <span className="tip-unit">{range ? t("ow.tp_unit_range", { range }) : t("ow.tp_unit")}</span>
          </>
        ) : (
          <>
            <span className="tip-fig">
              <span className="fig fig-m">{dayMonth(f.decideBy!)}</span>
            </span>
            <span className="tip-unit">{t("ow.tp_deadline")}</span>
          </>
        )}
        <span className="sr-only">{`. ${t("ow.tp_calc_sr")}`}</span>
        {chevron}
      </button>
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
        {ticks.map((tick) => (
          <span key={tick} className="due-tick" ref={css({ "inset-inline-start": `${(tick / SOON_DAYS) * 100}%` })}>
            <span>{tick === 0 ? t("ow.tp_today") : dayMonth(addDays(today, tick))}</span>
          </span>
        ))}
      </div>
      {pins.map(({ f, at }, i) => (
        <span key={f.id} className={`due-pin due-row-${i % 3}${daysBetween(today, f.decideBy!) < NEAR_DAYS ? " due-near" : ""}`} ref={css({ "inset-inline-start": `${(at / SOON_DAYS) * 100}%` })}>
          <span className="due-pin-label">
            <strong>{dayMonth(f.decideBy!)}</strong> <span className="due-pin-name">{short(f)}</span>
          </span>
        </span>
      ))}
    </div>
  );
}

export function Soon({ soon, today, short }: { soon: readonly Finding[]; today: IsoDate; short: (f: Finding) => string }) {
  if (!soon.length) return null;
  const first = soon[0]!;
  const left = first.decideBy ? daysBetween(today, first.decideBy) : null;
  return (
    <Section id="seuraavat" title={t("ow.tp_soon_title")} sub={left !== null ? t("ow.tp_soon_sub", { left }) : undefined}>
      <DueLine soon={soon} today={today} short={short} />
    </Section>
  );
}

/** Tips shown before Näytä kaikki: the ones worth most a year. */
const SHOWN = 5;

/** The figures an area shows beside its tips (fees by price list line, car costs): kept behind one line, not between the tips. */
function Summaries({ areas }: { areas: readonly AreaView[] }) {
  const withSummary = areas.filter((a) => a.summary);
  if (!withSummary.length) return null;
  return (
    <details className="tip-sums">
      <summary>{t("ow.tp_sums")}</summary>
      {withSummary.map((a) => (
        <div key={a.id} className="tip-sum">
          <h3 className="tip-sum-head">
            <AreaMark id={a.id} size={24} />
            <span>{a.summary!.title}</span>
          </h3>
          <dl className="calc tip-summary" aria-label={a.summary!.title}>
            {a.summary!.lines.map((l, i) => (
              <div key={i}>
                <dt>{l.label}</dt>
                <dd>{l.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      ))}
    </details>
  );
}

/**
 * The tips in one list, the largest effect a year first (core `byYearlyEffect`), five at a time. A tip names its area
 * on its card; Suurimmat säästökohteet narrows the list to one area and the line above it gives the way back.
 */
export function Tips({ areas, today, scope, onChanged, area, onArea }: { areas: readonly AreaView[]; today: IsoDate; scope: Scope; onChanged: Changed; area: AreaId | null; onArea: (area: AreaId | null) => void }) {
  const [all, setAll] = useState(false);
  const label = new Map(areas.map((a) => [a.id, a.label]));
  const every = byYearlyEffect(areas);
  if (!every.length) return null;
  const here = area ? every.filter((f) => f.area === area) : every;
  const shown = all ? here : here.slice(0, SHOWN);
  return (
    <Section id="vinkit" title={t("ow.tp_title")}>
      {area && (
        <p className="rt-filter" role="status">
          <span>
            {t("ow.tp_only_area")} <strong>{label.get(area)}</strong>.
          </span>
          <Button variant="link" onClick={() => onArea(null)}>
            {t("ow.tp_all_areas")}
          </Button>
        </p>
      )}
      <Opened views={shown.map((f) => findingView(f.id))} />
      <div className="tips">
        {shown.map((f) => (
          <TipCard key={f.id} finding={f} area={label.get(f.area)} today={today} scope={scope} onChanged={onChanged} />
        ))}
      </div>
      {here.length > SHOWN && (
        <Button className="tips-more" onClick={() => setAll((v) => !v)} aria-expanded={all}>
          {all ? t("ow.tp_fewer") : t("ow.tp_all", { n: here.length })}
        </Button>
      )}
      <Summaries areas={area ? areas.filter((a) => a.id === area) : areas} />
    </Section>
  );
}
