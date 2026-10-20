/**
 * The period of the list, picked from a short list of periods or on a calendar of our own (no browser date field,
 * whose look and order of day and month follow the browser and not the page). A period is two dates, both included;
 * an empty one is the whole history.
 */
import { addDays } from "@banking/core";
import { useState } from "react";
import { date, dayMonth, monthLong } from "../../format.ts";

export interface Period {
  from: string;
  to: string;
}

const pad = (n: number) => String(n).padStart(2, "0");
const monthStart = (iso: string) => `${iso.slice(0, 7)}-01`;
const shiftMonth = (month: string, by: number): string => {
  const n = Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1 + by;
  return `${Math.floor(n / 12)}-${pad((n % 12) + 1)}`;
};
const monthEnd = (month: string) => addDays(`${shiftMonth(month, 1)}-01`, -1);

/** The periods a household asks for most, as of `today`. */
export function presets(today: string): { label: string; period: Period }[] {
  const month = today.slice(0, 7);
  const year = today.slice(0, 4);
  const last = shiftMonth(month, -1);
  return [
    { label: "Tämä kuu", period: { from: monthStart(today), to: today } },
    { label: "Edellinen kuu", period: { from: `${last}-01`, to: monthEnd(last) } },
    { label: "3 kuukautta", period: { from: `${shiftMonth(month, -2)}-01`, to: today } },
    { label: "Tämä vuosi", period: { from: `${year}-01-01`, to: today } },
    { label: "Edellinen vuosi", period: { from: `${Number(year) - 1}-01-01`, to: `${Number(year) - 1}-12-31` } },
    { label: "Koko historia", period: { from: "", to: "" } },
  ];
}

/** What the period chip says: a named period, else the two days ("1.9.–30.9.2026"). */
export function periodLabel(p: Period, today: string): string {
  const named = presets(today).find((x) => x.period.from === p.from && x.period.to === p.to);
  if (named) return named.label;
  if (p.from && p.to) return p.from.slice(0, 4) === p.to.slice(0, 4) ? `${dayMonth(p.from)}–${date(p.to)}` : `${date(p.from)}–${date(p.to)}`;
  return p.from ? `${date(p.from)} alkaen` : `${date(p.to)} asti`;
}

const WEEKDAYS = ["ma", "ti", "ke", "to", "pe", "la", "su"];

/** The days of a month's calendar, Monday first; null fills the week before the first day. */
function monthGrid(month: string): (string | null)[] {
  const first = new Date(`${month}-01T00:00:00Z`);
  const lead = (first.getUTCDay() + 6) % 7;
  const days = Number(monthEnd(month).slice(8, 10));
  return [...Array<null>(lead).fill(null), ...Array.from({ length: days }, (_, i) => `${month}-${pad(i + 1)}`)];
}

export function DateRange({ value, today, onCommit }: { value: Period; today: string; onCommit: (p: Period) => void }) {
  const [draft, setDraft] = useState<Period>(value);
  const [month, setMonth] = useState((value.to || value.from || today).slice(0, 7));
  const pick = (d: string) => {
    if (!draft.from || draft.to || d < draft.from) setDraft({ from: d, to: "" });
    else setDraft({ from: draft.from, to: d });
  };
  const inRange = (d: string) => !!draft.from && d >= draft.from && d <= (draft.to || draft.from);
  return (
    <div className="tx-range">
      <ul className="tx-range-presets" aria-label="Valmiit jaksot">
        {presets(today).map((p) => {
          const on = p.period.from === value.from && p.period.to === value.to;
          return (
            <li key={p.label}>
              <button type="button" aria-pressed={on} onClick={() => onCommit(p.period)}>
                {p.label}
              </button>
            </li>
          );
        })}
      </ul>
      <div className="tx-cal">
        <div className="tx-cal-head">
          <button type="button" className="icon-btn" aria-label="Edellinen kuukausi" onClick={() => setMonth(shiftMonth(month, -1))}>
            ‹
          </button>
          <span className="tx-cal-month">{monthLong(month)}</span>
          <button type="button" className="icon-btn" aria-label="Seuraava kuukausi" disabled={month >= today.slice(0, 7)} onClick={() => setMonth(shiftMonth(month, 1))}>
            ›
          </button>
        </div>
        <div className="tx-cal-grid" role="grid" aria-label={monthLong(month)}>
          {WEEKDAYS.map((w) => (
            <span key={w} className="tx-cal-wd" aria-hidden="true">
              {w}
            </span>
          ))}
          {monthGrid(month).map((d, i) =>
            d ? (
              <button
                key={d}
                type="button"
                className={`tx-cal-day${inRange(d) ? " in" : ""}${d === draft.from || d === draft.to ? " end" : ""}${d === today ? " today" : ""}`}
                disabled={d > today}
                aria-pressed={inRange(d)}
                aria-label={date(d)}
                onClick={() => pick(d)}
              >
                {Number(d.slice(8, 10))}
              </button>
            ) : (
              <span key={`e${i}`} />
            ),
          )}
        </div>
        <div className="tx-cal-foot">
          <span className="tx-cal-pick">{draft.from ? periodLabel({ from: draft.from, to: draft.to || draft.from }, today) : "Valitse ensimmäinen päivä"}</span>
          <button type="button" className="btn btn-primary btn-small" disabled={!draft.from} onClick={() => onCommit({ from: draft.from, to: draft.to || draft.from })}>
            Näytä jakso
          </button>
        </div>
      </div>
    </div>
  );
}
