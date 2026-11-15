/**
 * A row opened in place: the payee's last twelve months as small bars, with the count, the mean purchase and the
 * total. Decision: is this payee a habit worth a look, and is this row like its others. The months, their counts and
 * means are server fields (`/api/merchants/summary`); the web scales the bars and adds nothing up.
 */
import { query } from "../../api.ts";
import { Figure } from "../../components/Figure.tsx";
import { CADENCE_LABEL, date, money, monthLabel } from "../../format.ts";
import { t, tn } from "../../text.ts";
import { useApi } from "../../hooks.ts";
import type { Scope } from "../../types.ts";
import { css } from "../../css.ts";

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
  if (!s?.months || !s.year) return <div className="tx-drill-body muted">{t("tx.drill_missing")}</div>;
  const max = Math.max(0, ...s.months.map((m) => m.outCents));
  const peak = s.months.findIndex((m) => m.outCents === max && max > 0);
  const onPhone = phoneMonthLabels(s.months.length, peak);
  return (
    <div className="tx-drill-body">
      <dl className="tx-drill-figs">
        <div>
          <dt>{t("tx.12_months")}</dt>
          <dd>
            <Figure text={money(s.year.outCents, false)} size="s" />
          </dd>
        </div>
        <div>
          <dt>{t("tx.count_name")}</dt>
          <dd>
            <Figure text={String(s.year.count)} size="s" whole />
          </dd>
        </div>
        <div>
          <dt>{t("tx.mean")}</dt>
          <dd>{s.year.meanCents === null ? "–" : <Figure text={money(s.year.meanCents, false)} size="s" />}</dd>
        </div>
        {s.recurring?.active && (
          <div>
            <dt>{t("tx.repeats")}</dt>
            <dd className="tx-drill-text">
              {CADENCE_LABEL[s.recurring.cadence] ?? s.recurring.cadence}
              {s.recurring.nextDate ? t("tx.next_comma", { date: date(s.recurring.nextDate) }) : ""}
            </dd>
          </div>
        )}
      </dl>
      <figure className="tx-drill-chart">
        <figcaption className="sr-only">{t("tx.drill_caption", { merchant, max: money(max) })}</figcaption>
        <ol className="tx-drill-bars">
          {s.months.map((m, i) => (
            <li key={m.month} className={i === peak ? "peak" : undefined} title={t("tx.drill_bar", { month: monthLabel(m.month, true), amount: money(m.outCents), events: tn(m.count, "tx.event_one", "tx.event_many") })}>
              <span className="tx-drill-val">{i === peak ? money(m.outCents) : ""}</span>
              <span className="tx-drill-bar" ref={css({ "block-size": `${max ? Math.max((m.outCents / max) * 100, m.outCents ? 4 : 0) : 0}%` })} />
              <span className={`tx-drill-month${onPhone[i] ? "" : " tx-drill-minor"}`}>{monthLabel(m.month)}</span>
            </li>
          ))}
        </ol>
      </figure>
      <a className="tx-drill-link" href={`#/transactions${query({ merchant })}`}>
        {t("tx.drill_all")}
      </a>
    </div>
  );
}
