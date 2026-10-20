/**
 * A row opened in place: the payee's last twelve months as small bars, with the count, the mean purchase and the
 * total. Decision: is this payee a habit worth a look, and is this row like its others. The months, their counts and
 * means are server fields (`/api/merchants/summary`); the web scales the bars and adds nothing up.
 */
import { query } from "../../api.ts";
import { Figure } from "../../components/Figure.tsx";
import { CADENCE_LABEL, date, money, monthLabel, plural } from "../../format.ts";
import { useApi } from "../../hooks.ts";
import type { Scope } from "../../types.ts";

interface MonthRow {
  month: string;
  count: number;
  outCents: number;
  meanCents: number | null;
}

interface Summary {
  merchant: string;
  months?: MonthRow[];
  year?: { count: number; outCents: number; meanCents: number | null };
  recurring: { cadence: string; active: boolean; nextDate: string | null } | null;
}

/**
 * Which months keep their label on a phone, where twelve names do not fit side by side: every third, counted back from
 * the newest, and the peak. A month beside the peak gives its label up to it.
 */
export function phoneMonthLabels(count: number, peak: number): boolean[] {
  return Array.from({ length: count }, (_, i) => i === peak || ((count - 1 - i) % 3 === 0 && (peak < 0 || Math.abs(i - peak) > 1)));
}

export function MerchantDrill({ merchant, scope }: { merchant: string; scope: Scope }) {
  const { data, loading } = useApi<{ summary: Summary | null }>(`/api/merchants/summary${query({ merchant, scope })}`);
  const s = data?.summary;
  if (loading && !s) return <div className="tx-drill-body tx-drill-wait" aria-busy="true" />;
  if (!s?.months || !s.year) return <div className="tx-drill-body muted">Kauppiaan kuukausitiedot puuttuvat.</div>;
  const max = Math.max(0, ...s.months.map((m) => m.outCents));
  const peak = s.months.findIndex((m) => m.outCents === max && max > 0);
  const onPhone = phoneMonthLabels(s.months.length, peak);
  return (
    <div className="tx-drill-body">
      <dl className="tx-drill-figs">
        <div>
          <dt>12 kuukautta</dt>
          <dd>
            <Figure text={money(s.year.outCents)} size="s" />
          </dd>
        </div>
        <div>
          <dt>Tapahtumia</dt>
          <dd>
            <Figure text={String(s.year.count)} size="s" whole />
          </dd>
        </div>
        <div>
          <dt>Ostoskerta keskimäärin</dt>
          <dd>{s.year.meanCents === null ? "–" : <Figure text={money(s.year.meanCents)} size="s" />}</dd>
        </div>
        {s.recurring?.active && (
          <div>
            <dt>Toistuu</dt>
            <dd className="tx-drill-text">
              {CADENCE_LABEL[s.recurring.cadence] ?? s.recurring.cadence}
              {s.recurring.nextDate ? `, seuraava ${date(s.recurring.nextDate)}` : ""}
            </dd>
          </div>
        )}
      </dl>
      <figure className="tx-drill-chart">
        <figcaption className="sr-only">{`${merchant}: maksettu kuukausittain, eniten ${money(max)}`}</figcaption>
        <ol className="tx-drill-bars">
          {s.months.map((m, i) => (
            <li key={m.month} className={i === peak ? "peak" : undefined} title={`${monthLabel(m.month, true)}: ${money(m.outCents)}, ${plural(m.count, "tapahtuma", "tapahtumaa")}`}>
              <span className="tx-drill-val">{i === peak ? money(m.outCents) : ""}</span>
              <span className="tx-drill-bar" style={{ blockSize: `${max ? Math.max((m.outCents / max) * 100, m.outCents ? 4 : 0) : 0}%` }} />
              <span className={`tx-drill-month${onPhone[i] ? "" : " tx-drill-minor"}`}>{monthLabel(m.month)}</span>
            </li>
          ))}
        </ol>
      </figure>
      <a className="tx-drill-link" href={`#/transactions${query({ merchant })}`}>
        Kaikki kauppiaan tapahtumat
      </a>
    </div>
  );
}
