// Decision: where to cut
import { query } from "../../../api.ts";
import { money, percent, signedMoney } from "../../../format.ts";
import { addsUp } from "../../../marks.ts";
import { ExportLink, NEGATIVE_TOTAL_NOTE } from "../parts.tsx";
import { Section } from "../../../components/Section.tsx";
import type { ReportSection, SectionProps } from "../types.ts";

function Change({ now, before }: { now: number; before: number }) {
  if (!before && !now) return <span className="muted">–</span>;
  const diff = now - before;
  return <span className={Math.abs(diff) < 100 ? "muted" : diff > 0 ? "worse" : "better"}>{signedMoney(diff)}</span>;
}

/**
 * Where the money went: total, share and a usual month per category. The
 * monthly spread, counts and the three-month trend are in the CSV; on the
 * page they made ten columns that a household reads past.
 */
function Categories({ ctx }: SectionProps) {
  const r = ctx.data.categories;
  const { range } = ctx;
  // a running month is no monthly figure: without a complete month in the range the column is left out
  const hasAverage = r.groups.some((g) => g.categories.some((c) => c.monthlyAvgCents !== null));
  const negative = r.groups.some((g) => g.totalCents < 0 || g.categories.some((c) => c.totalCents < 0));
  // the groups are the parts of the printed Yhteensä: the bracket stands only when they add up to it to the cent
  const sums = addsUp(r.groups.map((g) => g.totalCents), r.totalCents);
  const lastGroup = r.groups.length - 1;
  return (
    <Section id={section.id} title={section.title} sub={r.comparable ? "Muutos edellisestä jaksosta" : undefined} actions={<ExportLink href={ctx.exportHref("categories")} />}>
      <div className="table-wrap">
        <table className="ruled">
          <thead>
            <tr>
              <th>Kategoria</th>
              <th className="num">Yhteensä</th>
              <th className="num">Osuus menoista</th>
              {hasAverage && <th className="num hide-phone">Keskimäärin kuussa</th>}
              {r.comparable && <th className="num">Muutos</th>}
            </tr>
          </thead>
          <tbody className={sums ? "adds-up" : undefined}>
            {r.groups.map((g, gi) => [
              <tr key={g.group} className={`group-row${sums && gi === 0 ? " part-first" : ""}${sums && gi === lastGroup ? " part-last" : ""}`}>
                <td>{g.group}</td>
                <td className={`num${sums ? " sum" : ""}`}>{money(g.totalCents, false)}</td>
                <td className="num">{g.totalCents < 0 ? "–" : percent(g.share)}</td>
                {hasAverage && <td className="num hide-phone">{money(g.categories.reduce((s, c) => s + (c.monthlyAvgCents ?? 0), 0), false)}</td>}
                {r.comparable && (
                  <td className="num">
                    <Change now={g.totalCents} before={g.previousCents} />
                  </td>
                )}
              </tr>,
              ...g.categories.map((c) => (
                <tr key={c.category}>
                  <td style={{ paddingLeft: 20 }}>
                    <a href={`#/transactions${query({ category: c.category, from: range.from, to: range.to })}`}>{c.label}</a>
                  </td>
                  <td className={`num${sums ? " sum-pad" : ""}`}>{money(c.totalCents, false)}</td>
                  <td className="num">{c.totalCents < 0 ? "–" : percent(c.share)}</td>
                  {hasAverage && <td className="num hide-phone">{c.monthlyAvgCents === null ? "–" : money(c.monthlyAvgCents, false)}</td>}
                  {r.comparable && (
                    <td className="num">
                      <Change now={c.totalCents} before={c.previousCents} />
                    </td>
                  )}
                </tr>
              )),
            ])}
          </tbody>
          {r.groups.length > 0 && (
            <tfoot>
              <tr className="foot-row">
                <td>Yhteensä</td>
                <td className={`num${sums ? " sum-pad" : ""}`}>{money(r.totalCents, false)}</td>
                <td className="num">{percent(r.totalCents ? 1 : 0)}</td>
                {hasAverage && <td className="num hide-phone">{money(r.groups.reduce((s, g) => s + g.categories.reduce((t, c) => t + (c.monthlyAvgCents ?? 0), 0), 0), false)}</td>}
                {r.comparable && (
                  <td className="num">
                    <Change now={r.totalCents} before={r.previousTotalCents} />
                  </td>
                )}
              </tr>
            </tfoot>
          )}
        </table>
        {!r.groups.length && <div className="empty">Ei menoja valitulla jaksolla.</div>}
      </div>
      {negative && <p className="small muted">{NEGATIVE_TOTAL_NOTE}</p>}
    </Section>
  );
}

export const section: ReportSection = {
  id: "kategoriat",
  title: "Kategoriat",
  order: 30,
  page: "reports",
  reports: ["categories"],
  Component: Categories,
};
