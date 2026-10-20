/**
 * Decision: which bill of the month to chase now, and how much of the month's bills is still to leave.
 *
 * The month board (PD-laskut): every subscription and bill of the month as paid, missing or coming, a missed one first.
 * The head carries the month's due, the strip under it the three states with their sums and the fixed costs of a month,
 * a line of the month's days shows when each bill falls, and the list says each one with its day. Every sum is a field
 * of `/api/bill-month` (core `billMonth`) and opens its rows (`Why`, the `bills.*` figures); the web draws shares of the
 * month's due and adds up nothing. A coming or missing bill is the series' usual charge, so it wears "≈" where its sum varies.
 */
import type { BillBoard, BillBoardRow, BillState } from "@banking/core";
import { dayHeading, dayMonth, money, monthLong, plural } from "../../format.ts";
import type { Scope } from "../../types.ts";
import { Figure } from "../Figure.tsx";
import { MerchantAvatar } from "../MerchantAvatar.tsx";
import { Estimate, Why } from "../Why.tsx";

/** What `/api/bill-month` answers. */
export interface BillMonthAnswer {
  board: BillBoard;
}

const STATE_WORD: Record<BillState, string> = { missing: "Puuttuu", coming: "Tulossa", paid: "Maksettu" };
const TOTAL: Record<BillState, "missingCents" | "comingCents" | "paidCents"> = { missing: "missingCents", coming: "comingCents", paid: "paidCents" };
const STATES: BillState[] = ["missing", "coming", "paid"];

/** The sign of a state, so no state is told by its colour alone: a check, a clock, a warning. */
function StateIcon({ state }: { state: BillState }) {
  return (
    <svg className={`mb-icon mb-icon-${state}`} viewBox="0 0 16 16" width={16} height={16} aria-hidden="true" focusable="false">
      {state === "paid" && (
        <>
          <circle cx={8} cy={8} r={7} />
          <path d="M4.6 8.3 7 10.6l4.4-4.8" />
        </>
      )}
      {state === "coming" && (
        <>
          <circle cx={8} cy={8} r={6.25} />
          <path d="M8 4.6V8l2.4 1.6" />
        </>
      )}
      {state === "missing" && (
        <>
          <path d="M8 1.6 15 14H1z" />
          <path d="M8 6v3.6M8 11.4v.4" />
        </>
      )}
    </svg>
  );
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** The month before or after `month`, "YYYY-MM". */
function stepMonth(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const i = y * 12 + (m - 1) + n;
  return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}`;
}

/** `fixedRange`: the fixed costs are a month as the series run today, so they open up to today and stand only on the running month. */
export function MonthBoard({ board, loading, onMonth, today, scope, fixedEstimate, fixedRange }: { board: BillBoard; loading: boolean; onMonth: (month: string) => void; today: string; scope: Scope; fixedEstimate: boolean; fixedRange: { from: string; to: string } }) {
  const running = board.month === today.slice(0, 7);
  const shown = STATES.filter((s) => board.rows.some((r) => r.state === s));
  const range = { from: board.from, to: board.to };
  const estimated = (s: BillState) => board.rows.some((r) => r.state === s && r.estimate);
  const monthName = monthLong(board.month);
  return (
    <section className={`card mb span-12${loading ? " loading" : ""}`} aria-labelledby="mb-title" aria-busy={loading || undefined}>
      <div className="card-head tb">
        <div className="card-name mb-name">
          <div className="mb-nav">
            <button type="button" className="btn btn-small mb-step" disabled={board.month <= board.earliest} onClick={() => onMonth(stepMonth(board.month, -1))} aria-label="Edellinen kuukausi">
              ‹
            </button>
            <h2 id="mb-title">{capital(monthName)}</h2>
            <button type="button" className="btn btn-small mb-step" disabled={board.month >= board.latest} onClick={() => onMonth(stepMonth(board.month, 1))} aria-label="Seuraava kuukausi">
              ›
            </button>
          </div>
        </div>
        <div className="card-datum">
          <Why figure="bills.due" title="Kuukauden laskut yhteensä" range={range} scope={scope} text={money(board.totals.dueCents)} estimate={estimated("coming") || estimated("missing") ? "approx" : undefined}>
            <Figure text={money(board.totals.dueCents)} size="s" />
          </Why>
        </div>
      </div>

      <div className="mb-top">
        <dl className="mb-states">
          {shown.map((s) => (
            <div key={s} className={`mb-state mb-${s}`}>
              <dt>
                <StateIcon state={s} />
                {STATE_WORD[s]}
                <span className="mb-count">{board.rows.filter((r) => r.state === s).length}</span>
              </dt>
              <dd>
                <Why figure={`bills.${s}`} title={STATE_WORD[s]} range={range} scope={scope} text={money(board.totals[TOTAL[s]])} estimate={s !== "paid" && estimated(s) ? "approx" : undefined}>
                  <Figure text={money(board.totals[TOTAL[s]])} size="m" />
                </Why>
              </dd>
            </div>
          ))}
          {/* the fixed costs are those of the series as they run today, so another month would wear today's figure */}
          {running && board.fixedMonthlyCents > 0 && (
            <div className="mb-state mb-fixed">
              <dt>Kiinteät menot kuussa</dt>
              <dd>
                <Why figure="bills.fixed" title="Kiinteät menot kuussa" range={fixedRange} scope={scope} text={money(board.fixedMonthlyCents)} estimate={fixedEstimate ? "approx" : undefined}>
                  <Figure text={money(board.fixedMonthlyCents)} size="m" />
                </Why>
              </dd>
            </div>
          )}
        </dl>
        {board.rows.length > 0 && (
          <>
            <ShareBar board={board} />
            <DayLine board={board} today={running ? today : null} />
          </>
        )}
      </div>

      {shown.map((s) => (
        <div key={s} className={`mb-group mb-${s}`}>
          {/* the group's sum is the tile's above: the head names the state and counts its rows */}
          <h3 className="mb-group-head">
            <StateIcon state={s} />
            <span>{STATE_WORD[s]}</span>
            <span className="mb-group-count">{plural(board.rows.filter((r) => r.state === s).length, "lasku", "laskua")}</span>
          </h3>
          <ul className="mb-rows">
            {board.rows
              .filter((r) => r.state === s)
              .map((r, i) => (
                <BoardRow key={`${r.seriesId}:${r.date}:${i}`} r={r} today={today} />
              ))}
          </ul>
        </div>
      ))}
      {!board.rows.length && <p className="mb-empty">Tälle kuukaudelle ei ole laskuja.</p>}
    </section>
  );
}

/** What the day of a row says: when it was paid, when it is due, or how long a missed one has waited. */
function dayLine(r: BillBoardRow, today: string): string {
  if (r.state === "paid") return `Maksettu ${dayMonth(r.date)}${r.settledElsewhere ? " toiselta tililtä" : ""}`;
  const late = Math.round((Date.parse(today) - Date.parse(r.date)) / 86_400_000);
  if (r.state === "missing") return `Eräpäivä ${dayMonth(r.date)}, ${plural(late, "päivä", "päivää")} myöhässä`;
  if (late > 0) return `Eräpäivä ${dayMonth(r.date)}, odottaa veloitusta`;
  return capital(dayHeading(r.date, today));
}

function BoardRow({ r, today }: { r: BillBoardRow; today: string }) {
  return (
    <li className="mb-row">
      <MerchantAvatar name={r.merchant} person={false} />
      <div className="mb-what">
        <span className="mb-merchant">{r.merchant}</span>
        <span className="mb-day">
          {dayLine(r, today)}
          {r.onCard && <span className="mb-tag">Kortilla</span>}
        </span>
      </div>
      <div className="mb-sum">
        <span className={r.estimate ? "mb-estimate" : undefined}>
          <Estimate when={r.estimate}>{money(r.cents)}</Estimate>
        </span>
        {r.usualCents !== undefined && <span className="mb-usual">tavallisesti {money(r.usualCents)}</span>}
      </div>
    </li>
  );
}

/** The month's due as one bar split by state, in the order of the list: a missed share on the left where it is seen first. */
function ShareBar({ board }: { board: BillBoard }) {
  const due = board.totals.dueCents;
  if (!due) return null;
  return (
    <div className="mb-share" aria-hidden="true">
      {STATES.map((s) => {
        const part = board.totals[TOTAL[s]];
        return part > 0 ? <span key={s} className={`mb-share-${s}`} style={{ flexGrow: part / due }} /> : null;
      })}
    </div>
  );
}

/**
 * The days of the month as one line with each bill on its day, today as a rule. Several bills on a day stack upwards.
 * Decorative beside the list, which says the same in words; the marks keep the icons' shapes, so no state is told by
 * colour alone. In HTML on percentages, so a mark keeps its shape at any width.
 */
function DayLine({ board, today }: { board: BillBoard; today: string | null }) {
  const days = Number(board.to.slice(8, 10));
  const at = (d: number) => `${(((d - 1) / (days - 1)) * 100).toFixed(2)}%`;
  // a missed bill of an earlier month sits on the month's first day
  const dayOf = (iso: string) => (iso < board.from ? 1 : Number(iso.slice(8, 10)));
  const lane = new Map<number, number>();
  const marks = board.rows.map((r) => {
    const d = dayOf(r.date);
    const n = lane.get(d) ?? 0;
    lane.set(d, n + 1);
    return { r, d, n };
  });
  return (
    <div className="mb-line" aria-hidden="true">
      <div className="mb-track">
        {today && (
          <span className="mb-today" style={{ insetInlineStart: at(dayOf(today)) }}>
            <span className="mb-today-label">Tänään</span>
          </span>
        )}
        {marks.map(({ r, d, n }, i) => (
          <span key={i} className={`mb-mark mb-mark-${r.state}`} style={{ insetInlineStart: at(d), insetBlockEnd: `${6 + n * 12}px` }} />
        ))}
      </div>
      <div className="mb-ticks">
        {[1, 5, 10, 15, 20, 25, days].map((d) => (
          <span key={d} style={{ insetInlineStart: at(d) }}>
            {d}.
          </span>
        ))}
      </div>
    </div>
  );
}

/** The board while its first answer is on the way: the head, three state tiles and three rows at their final size. */
export function MonthBoardSkeleton() {
  return (
    <div className="card skeleton mb-sk span-12" aria-hidden="true">
      <span className="sk-bar sk-head" />
      <div className="mb-states">
        {[0, 1, 2].map((i) => (
          <div key={i} className="mb-state">
            <span className="sk-bar sk-name" />
            <span className="sk-bar sk-num" />
          </div>
        ))}
      </div>
      {[0, 1, 2].map((i) => (
        <span key={i} className="sk-row">
          <span className="sk-bar sk-name" />
          <span className="sk-bar sk-num" />
        </span>
      ))}
    </div>
  );
}
