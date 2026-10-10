import { fixedSplit, isFixedCost } from "@banking/core";
import { useState } from "react";
import { CADENCE_LABEL, count, date, money, plural } from "../format.ts";
import { useApi } from "../hooks.ts";
import { query } from "../api.ts";
import { Loading } from "../components/Loading.tsx";
import { ErrorCard } from "../components/ErrorCard.tsx";
import type { Meta, Recurring as Series, Scope } from "../types.ts";

interface SectionDef {
  title: string;
  filter: (s: Series) => boolean;
  sub?: string;
  habit?: boolean;
  ended?: boolean;
}

/** "Tarkista nämä" is the one a household can act on: it comes first, before the bills to come. */
const REVIEW: SectionDef = { title: "Tarkista nämä", sub: "Pieniä palveluja, jotka ovat jatkuneet yli puoli vuotta. Käytättekö niitä vielä?", filter: (s) => s.review };
const SECTIONS: SectionDef[] = [
  { title: "Tilaukset", filter: (s) => s.active && s.kind === "subscription" && s.category === "subscriptions" && !s.review },
  { title: "Vakiomaksut", filter: (s) => s.active && s.kind === "subscription" && s.category !== "subscriptions" && !s.review },
  { title: "Laskut", filter: (s) => s.active && s.kind === "bill" && !s.review },
  { title: "Arkiostot", filter: (s) => s.active && s.kind === "habit", habit: true },
  { title: "Tulot", filter: (s) => s.active && s.kind === "income" },
  { title: "Loppuneet", filter: (s) => !s.active && s.kind !== "habit", ended: true },
];

export function Recurring({ meta, scope }: { meta: Meta; scope: Scope }) {
  const { data, error, reload } = useApi<{ series: Series[] }>(`/api/recurring${query({ scope })}`);
  if (error && !data) return <ErrorCard message={error} onRetry={reload} />;
  if (!data) return <Loading />;

  const label = (id: string) => meta.categories.find((c) => c.id === id)?.label ?? id;
  const kindOf = (id: string) => meta.categories.find((c) => c.id === id)?.kind ?? "expense";
  const spending = (s: Series) => kindOf(s.category) === "expense" || kindOf(s.category) === "debt";
  // counted like the total: what leaves for good, savings and card bills not included
  const fixed = data.series.filter((s) => isFixedCost(s) && spending(s));
  // the same split and total as the overview's fixed costs tile
  const split = fixedSplit(data.series);
  const fixedTotal = split.consumptionCents + split.debtCents;
  const habitsTotal = data.series.filter((s) => s.active && s.kind === "habit").reduce((s, x) => s + x.monthlyCents, 0);

  const subs = data.series.filter((s) => s.active && s.kind === "subscription" && s.category === "subscriptions");
  const subsMonthly = subs.reduce((sum, s) => sum + s.monthlyCents, 0);
  const subsToCheck = subs.filter((s) => s.review).length;
  // charges still to come this month, in date order, like the overview's forecast: a charge a few days
  // late is still expected, one long overdue is not counted. The card bill is expected too.
  const monthEnd = `${meta.today.slice(0, 7)}-31`;
  const coming = data.series
    .filter((s) => s.active && !s.overdue && (s.kind === "subscription" || s.kind === "bill") && spending(s))
    .filter((s) => s.nextDate !== null && s.nextDate.slice(0, 7) <= meta.today.slice(0, 7) && s.nextDate <= monthEnd)
    .sort((a, b) => (a.nextDate ?? "").localeCompare(b.nextDate ?? ""));
  const comingTotal = coming.reduce((sum, s) => sum + s.typicalAmountCents, 0);

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
            {plural(fixed.length, "maksu", "maksua")} · {money(fixedTotal * 12, false)}/v
          </div>
        </div>
        <div className="card">
          <div className="tile-label">Tilaukset</div>
          <div className="tile-value">{money(subsMonthly, false)}/kk</div>
          <div className="tile-note">
            {subs.length
              ? `${plural(subs.length, "tilaus", "tilausta")} · ${money(subsMonthly * 12, false)}/v${subsToCheck ? `, ${subsToCheck} kohdassa Tarkista nämä` : ""}`
              : "Ei tilauksia"}
          </div>
        </div>
        <div className="card">
          <div className="tile-label">Vielä tässä kuussa</div>
          <div className="tile-value">{money(comingTotal, false)}</div>
          <div className="tile-note">{coming.length ? plural(coming.length, "maksu", "maksua") : "Ei maksuja jäljellä"}</div>
        </div>
        <div className="card">
          <div className="tile-label">Arkiostot</div>
          <div className="tile-value">{money(habitsTotal, false)}/kk</div>
          <div className="tile-note">Ruokakaupat, kahvilat ja muut toistuvat pienet ostot</div>
        </div>
      </div>

      <SeriesSection section={REVIEW} rows={data.series.filter(REVIEW.filter)} {...sectionProps} />
      <Coming rows={coming} total={comingTotal} today={meta.today} />
      {SECTIONS.map((section) => (
        <SeriesSection key={section.title} section={section} rows={data.series.filter(section.filter)} {...sectionProps} />
      ))}
      {!data.series.length && <div className="card empty">Toistuvia maksuja ei vielä löytynyt.</div>}
    </div>
  );
}

const COMING_SHOWN = 8;

function Coming({ rows, total, today }: { rows: Series[]; total: number; today: string }) {
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
          {shown.map((s) => (
            <tr key={s.id}>
              <td>
                <a href={`#/transactions?merchant=${encodeURIComponent(s.merchant)}`}>{s.merchant}</a>
              </td>
              <td className="num muted">{s.nextDate! < today ? `${date(s.nextDate!)}, ei vielä näy` : date(s.nextDate!)}</td>
              <td className="num">{money(s.typicalAmountCents)}</td>
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
  if (habit) return `${count(s.perMonth)} krt/kk`;
  if (!s.cadence) return "–";
  const perYear = Math.round(s.perMonth * 12);
  return s.cadence === "monthly" && perYear < 12 ? `${perYear} kertaa vuodessa` : CADENCE_LABEL[s.cadence] ?? "–";
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
        <table>
          <thead>
            <tr>
              <th>Kauppias</th>
              <th className="hide-phone">Tiheys</th>
              <th className="num hide-phone">{section.habit ? "Tyypillinen" : "Summa"}</th>
              <th className="num">/kk</th>
              <th className="num">Vuodessa</th>
              <th className="num hide-phone">Jatkunut</th>
              <th>{section.habit || section.ended ? "Viimeksi" : "Seuraava"}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.id}>
                <td>
                  <a href={`#/transactions?merchant=${encodeURIComponent(s.merchant)}`}>{s.merchant}</a>
                  {s.priceChange && (
                    <span className={`badge ${s.priceChange.toCents > s.priceChange.fromCents ? "warn" : "good"}`}>
                      {money(s.priceChange.fromCents)} → {money(s.priceChange.toCents)}
                    </span>
                  )}
                  <div className="sub">
                    {label(s.category)} · {s.occurrences} krt, alkaen {date(s.firstDate)}
                  </div>
                </td>
                <td className="hide-phone">{frequency(s, !!section.habit)}</td>
                <td className="num hide-phone">{money(s.typicalAmountCents)}</td>
                <td className="num">
                  <strong>{money(s.monthlyCents)}</strong>
                </td>
                <td className="num">{money(s.yearlyCents, false)}</td>
                <td className="num hide-phone">{s.monthsActive} kk</td>
                <td style={{ whiteSpace: "nowrap" }}>
                  {section.habit || section.ended ? (
                    date(s.lastDate)
                  ) : s.overdue ? (
                    <span className="badge warn" title={`Odotettiin ${date(s.nextDate)}`}>
                      Myöhässä?
                    </span>
                  ) : (
                    date(s.nextDate)
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
