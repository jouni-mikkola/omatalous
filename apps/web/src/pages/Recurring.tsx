/**
 * Decision: cancel or keep a subscription. Every figure for subscriptions comes from one definition
 * (`isSubscription`, `subscriptionsMonthlyCents`), so the tile, the Tilaukset card and its review rows agree, and a
 * merchant marked as cancelled is out of the total.
 */
import {
  cancelledMerchants,
  type ExpectedCharge,
  fixedSplit,
  inUseQuietsQuestion,
  isFixedCost,
  isSubscription,
  type MarkKind,
  NO_INPUTS,
  subscriptionsMonthlyCents,
  type UserMark,
} from "@banking/core";
import { type ReactNode, useState } from "react";
import { CADENCE_LABEL, count, date, money, plural } from "../format.ts";
import { useApi } from "../hooks.ts";
import { api, query } from "../api.ts";
import { Loading } from "../components/Loading.tsx";
import { ErrorCard } from "../components/ErrorCard.tsx";
import { comingThisMonth } from "../coming.ts";
import type { Meta, Recurring as Series, Scope } from "../types.ts";
import "../styles/overview.css";
import "../styles/recurring.css";

interface SectionDef {
  title: string;
  filter: (s: Series) => boolean;
  sub?: string;
  habit?: boolean;
  ended?: boolean;
  /** Money that comes in is paid by someone, so the first column names the payer. */
  income?: boolean;
}

/** Subscriptions have a card of their own; these are the rest. */
const SECTIONS: SectionDef[] = [
  { title: "Sopimukset", sub: "Puhelin, vakuutukset, asuminen ja lainat kuuluvat kiinteisiin menoihin.", filter: (s) => s.active && s.kind === "subscription" && !isSubscription(s) },
  { title: "Laskut", filter: (s) => s.active && s.kind === "bill" },
  { title: "Arkiostot", filter: (s) => s.active && s.kind === "habit", habit: true },
  { title: "Tulot", filter: (s) => s.active && s.kind === "income", income: true },
  { title: "Loppuneet", filter: (s) => !s.active && s.kind !== "habit", ended: true },
];

/** What one subscription row can do next to the mark it already has. */
interface MarkControls {
  /** The mark on this merchant that still counts today, or null. */
  markOf: (merchant: string) => UserMark | null;
  busy: string | null;
  set: (merchant: string, mark: MarkKind | null) => void;
}

export function Recurring({ meta, scope }: { meta: Meta; scope: Scope }) {
  const { data, error, reload } = useApi<{ series: Series[]; marks: UserMark[] }>(`/api/recurring${query({ scope })}`);
  // what the last save answered: fresher than the list the page was loaded with
  const [saved, setSaved] = useState<UserMark[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [markError, setMarkError] = useState<string | null>(null);
  if (error && !data) return <ErrorCard message={error} onRetry={reload} />;
  if (!data) return <Loading />;

  const label = (id: string) => meta.categories.find((c) => c.id === id)?.label ?? id;
  const kindOf = (id: string) => meta.categories.find((c) => c.id === id)?.kind ?? "expense";
  const spending = (s: Series) => kindOf(s.category) === "expense" || kindOf(s.category) === "debt";

  const markList = saved ?? data.marks;
  const marks = new Map(markList.map((m) => [m.subject, m]));
  const cancelled = cancelledMerchants({ ...NO_INPUTS, marks: markList });
  const controls: MarkControls = {
    markOf: (merchant) => {
      const m = marks.get(`merchant:${merchant}`);
      return m && (m.mark === "cancelled" || inUseQuietsQuestion(m, meta.today)) ? m : null;
    },
    busy,
    set: (merchant, mark) => {
      const subject = `merchant:${merchant}`;
      setBusy(merchant);
      setMarkError(null);
      api<{ marks: UserMark[] }>("/api/marks", { method: "PUT", body: { subject, mark } })
        .then((res) => setSaved(res.marks))
        .catch((e: Error) => setMarkError(e.message))
        .finally(() => setBusy(null));
    },
  };

  // counted like the total: what leaves for good, savings and card bills not included; a merchant marked as cancelled is out
  const fixed = data.series.filter((s) => isFixedCost(s) && spending(s) && !cancelled.has(s.merchant));
  // the same split and total as the overview's fixed costs tile
  const split = fixedSplit(data.series, cancelled);
  const fixedTotal = split.consumptionCents + split.debtCents;
  const habitsTotal = data.series.filter((s) => s.active && s.kind === "habit").reduce((s, x) => s + x.monthlyCents, 0);

  // one definition of a subscription and one total: the tile, the card header and the rows below all come from these
  const allSubs = data.series.filter(isSubscription);
  const subs = allSubs.filter((s) => !cancelled.has(s.merchant));
  const stopped = allSubs.filter((s) => cancelled.has(s.merchant));
  const subsMonthly = subscriptionsMonthlyCents(data.series, cancelled);
  const toCheck = subs.filter((s) => s.review && !controls.markOf(s.merchant));
  const stoppedMonthly = subscriptionsMonthlyCents(stopped);
  // charges still to come this month by the forecast's own definition, each on its projected date
  const coming = comingThisMonth(data.series, meta.today, cancelled);
  const comingTotal = coming.reduce((sum, c) => sum + c.amountCents, 0);

  const sectionProps = { label };
  return (
    <div className="stack">
      <div className="grid kpis">
        <div className="card">
          <div className="tile-label">Kiinteät menot</div>
          <div className="tile-value">{money(fixedTotal, false)}/kk</div>
          <div className="tile-note">
            Kulutus {money(split.consumptionCents, false)} · Velanhoito {money(split.debtCents, false)}
          </div>
          <div className="delta">
            {plural(fixed.length, "maksu", "maksua")} · {money(fixedTotal * 12, false)} vuodessa
          </div>
        </div>
        <div className="card">
          <div className="tile-label">Tilaukset</div>
          <div className="tile-value">{money(subsMonthly, false)}/kk</div>
          <div className="tile-note">
            {subs.length
              ? `${plural(subs.length, "tilaus", "tilausta")} · ${money(subsMonthly * 12, false)} vuodessa${toCheck.length ? `, ${toCheck.length} tarkistettavaa` : ""}`
              : "Ei tilauksia"}
          </div>
          {stopped.length > 0 && <div className="delta">{money(stoppedMonthly, false)} kuussa merkitty lopetetuksi, ei mukana</div>}
        </div>
        <div className="card">
          <div className="tile-label">Tulossa tässä kuussa</div>
          <div className="tile-value">{money(comingTotal, false)}</div>
          <div className="tile-note">{coming.length ? plural(coming.length, "maksu", "maksua") : "Ei maksuja jäljellä"}</div>
        </div>
        <div className="card">
          <div className="tile-label">Arkiostot</div>
          <div className="tile-value">{money(habitsTotal, false)}/kk</div>
          <div className="tile-note">Ruokakaupat, kahvilat ja muut toistuvat pienet ostot</div>
        </div>
      </div>

      {markError && (
        <div className="error" role="alert">
          {markError}
        </div>
      )}
      <Subscriptions subs={subs} stopped={stopped} total={subsMonthly} controls={controls} {...sectionProps} />
      <Coming rows={coming} total={comingTotal} today={meta.today} />
      {SECTIONS.map((section) => (
        <SeriesSection key={section.title} section={section} rows={data.series.filter(section.filter)} {...sectionProps} />
      ))}
      {!data.series.length && <div className="card empty">Toistuvia maksuja ei vielä löytynyt. Ne tunnistetaan, kun samalta kauppiaalta on useita maksuja eri kuukausina.</div>}
    </div>
  );
}

const COMING_SHOWN = 8;

function Coming({ rows, total, today }: { rows: ExpectedCharge[]; total: number; today: string }) {
  const [all, setAll] = useState(false);
  if (!rows.length) return null;
  const shown = all ? rows : rows.slice(0, COMING_SHOWN);
  return (
    <div className="card">
      <div className="card-head">
        <div>
          <h2>Tulossa tässä kuussa</h2>
          <div className="card-sub">Summa on arvio edellisten maksujen mukaan.</div>
        </div>
        <strong>{money(total, false)}</strong>
      </div>
      <table className="compact">
        <caption className="sr-only">Maksut, jotka erääntyvät tässä kuussa</caption>
        <tbody>
          {shown.map((c, i) => (
            <tr key={`${c.merchant}|${c.date}|${i}`}>
              <td>
                <a href={`#/transactions?merchant=${encodeURIComponent(c.merchant)}`}>{c.merchant}</a>
              </td>
              <td className="num muted">{c.date < today ? `${date(c.date)}, ei vielä näy` : date(c.date)}</td>
              <td className="num">{money(c.amountCents)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > COMING_SHOWN && (
        <button className="btn btn-small upcoming-more" type="button" onClick={() => setAll((v) => !v)} aria-expanded={all}>
          {all ? "Näytä vähemmän" : `Näytä kaikki (${rows.length})`}
        </button>
      )}
    </div>
  );
}

/** "kuukausittain", or "11 kertaa vuodessa" for a monthly fee with a summer break. */
function frequency(s: Series, habit: boolean): string {
  if (habit) return `${count(s.perMonth)} kertaa kuussa`;
  if (!s.cadence) return "–";
  const perYear = Math.round(s.perMonth * 12);
  return s.cadence === "monthly" && perYear < 12 ? `${perYear} kertaa vuodessa` : CADENCE_LABEL[s.cadence] ?? "–";
}

const COLUMNS = 7;

function SeriesHead({ habit, ended, income }: { habit?: boolean; ended?: boolean; income?: boolean }) {
  return (
    <thead>
      <tr>
        <th>{income ? "Maksaja" : "Kauppias"}</th>
        <th className="hide-phone">Tiheys</th>
        <th className="num hide-phone">{habit ? "Tyypillinen" : "Summa"}</th>
        <th className="num">Kuussa</th>
        <th className="num hide-phone">Vuodessa</th>
        <th className="num hide-phone">Jatkunut</th>
        <th>{habit || ended ? "Viimeksi" : "Seuraava"}</th>
      </tr>
    </thead>
  );
}

function SeriesRow({ s, label, habit, ended, actions }: { s: Series; label: (id: string) => string; habit?: boolean; ended?: boolean; actions?: ReactNode }) {
  return (
    <tr>
      <td>
        <a href={`#/transactions?merchant=${encodeURIComponent(s.merchant)}`}>{s.merchant}</a>
        {s.priceChange && (
          <span className={`badge ${s.priceChange.toCents > s.priceChange.fromCents ? "warn" : "good"}`}>
            {money(s.priceChange.fromCents)} → {money(s.priceChange.toCents)}
          </span>
        )}
        <div className="sub">
          {label(s.category)} · {s.occurrences} kertaa {date(s.firstDate)} alkaen
        </div>
        {actions}
      </td>
      <td className="hide-phone">{frequency(s, !!habit)}</td>
      <td className="num hide-phone">{money(s.typicalAmountCents)}</td>
      <td className="num">
        <strong>{money(s.monthlyCents, false)}</strong>
      </td>
      <td className="num hide-phone">{money(s.yearlyCents, false)}</td>
      <td className="num hide-phone">{plural(s.monthsActive, "kuukausi", "kuukautta")}</td>
      <td className="next">
        {habit || ended ? (
          date(s.lastDate)
        ) : s.overdue ? (
          <span className="badge warn" title={`Odotettiin ${date(s.nextDate)}`}>
            Myöhässä
          </span>
        ) : (
          date(s.nextDate)
        )}
      </td>
    </tr>
  );
}

function SeriesSection({ section, rows, label }: { section: SectionDef; rows: Series[]; label: (id: string) => string }) {
  if (!rows.length) return null;
  return (
    <div className="card">
      <div className="card-head">
        <div>
          <h2>{section.title}</h2>
          {section.sub && <div className="card-sub">{section.sub}</div>}
        </div>
        <strong>{money(rows.reduce((s, r) => s + r.monthlyCents, 0), false)}/kk</strong>
      </div>
      <div className="table-wrap">
        <table className="recurring-table">
          <SeriesHead habit={section.habit} ended={section.ended} income={section.income} />
          <tbody>
            {rows.map((s) => (
              <SeriesRow key={s.id} s={s} label={label} habit={section.habit} ended={section.ended} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * The subscriptions the household chose and may drop. The header total is the one on the tile. Rows that are asked
 * about come first; a merchant marked as cancelled is listed below, outside the total, until its charges stop.
 */
function Subscriptions({ subs, stopped, total, controls, label }: { subs: Series[]; stopped: Series[]; total: number; controls: MarkControls; label: (id: string) => string }) {
  if (!subs.length && !stopped.length) return null;
  const asked = subs.filter((s) => s.review && !controls.markOf(s.merchant));
  const groups = [
    { key: "asked", title: "Tarkista nämä", sub: "Pieniä palveluja, joita on maksettu yli puoli vuotta", rows: asked },
    { key: "rest", title: asked.length ? "Muut tilaukset" : null, sub: undefined, rows: subs.filter((s) => !asked.includes(s)) },
    { key: "stopped", title: "Merkitty lopetetuksi", sub: "Ei mukana summassa.", rows: stopped },
  ].filter((g) => g.rows.length);
  return (
    <div className="card">
      <div className="card-head">
        <div>
          <h2>Tilaukset</h2>
          <div className="card-sub">Palvelut, jotka voit lopettaa.</div>
        </div>
        <strong>{money(total, false)}/kk</strong>
      </div>
      <div className="table-wrap">
        <table className="recurring-table">
          <SeriesHead />
          {groups.map((g) => (
            <tbody key={g.key}>
              {g.title && (
                <tr className="group-head">
                  <th colSpan={COLUMNS} scope="colgroup">
                    {g.title}
                    {g.sub && <span className="group-sub">{g.sub}</span>}
                  </th>
                </tr>
              )}
              {g.rows.map((s) => (
                <SeriesRow key={s.id} s={s} label={label} actions={<MarkButtons s={s} controls={controls} />} />
              ))}
            </tbody>
          ))}
        </table>
      </div>
    </div>
  );
}

/** The saving, and what to say about this subscription. A mark that counts shows as a badge with an undo. */
function MarkButtons({ s, controls }: { s: Series; controls: MarkControls }) {
  const mark = controls.markOf(s.merchant);
  const off = controls.busy !== null;
  if (mark) {
    return (
      <div className="sub-actions">
        <span className={`badge ${mark.mark === "cancelled" ? "warn" : "good"}`}>{mark.mark === "cancelled" ? "Lopetettu" : "Käytössä"}</span>
        <button className="btn btn-small" type="button" disabled={off} aria-label={`Kumoa: ${s.merchant}`} onClick={() => controls.set(s.merchant, null)}>
          Kumoa
        </button>
      </div>
    );
  }
  return (
    <div className="sub-actions">
      <span className="sub-saving">Lopettamalla säästät {money(s.yearlyCents, false)} vuodessa</span>
      <button className="btn btn-small" type="button" disabled={off} aria-label={`Käytössä: ${s.merchant}`} onClick={() => controls.set(s.merchant, "in_use")}>
        Käytössä
      </button>
      <button className="btn btn-small" type="button" disabled={off} aria-label={`Lopetettu: ${s.merchant}`} onClick={() => controls.set(s.merchant, "cancelled")}>
        Lopetettu
      </button>
    </div>
  );
}
