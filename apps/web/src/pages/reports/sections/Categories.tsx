// Decision: where to cut
import { query } from "../../../api.ts";
import { money, percent, signedMoney } from "../../../format.ts";
import { ExportLink } from "../parts.tsx";
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
  // a share says of what: spending is the base of the first, income of the second
  const hasIncome = r.incomeCents > 0;
  return (
    <Section id={section.id} title={section.title} sub={r.comparable ? "Muutos edelliseen jaksoon" : undefined} actions={<ExportLink href={ctx.exportHref("categories")} />}>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Kategoria</th>
              <th className="num">Yhteensä</th>
              <th className="num">Osuus menoista</th>
              {hasIncome && <th className="num hide-phone">Osuus tuloista</th>}
              {hasAverage && <th className="num hide-phone">Keskimäärin kuussa</th>}
              {r.comparable && <th className="num">Muutos</th>}
            </tr>
          </thead>
          <tbody>
            {r.groups.map((g) => [
              <tr key={g.group} className="group-row">
                <td>{g.group}</td>
                <td className="num">{money(g.totalCents, false)}</td>
                <td className="num">{percent(g.share)}</td>
                {hasIncome && <td className="num hide-phone">{percent(g.incomeShare ?? 0)}</td>}
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
                  <td className="num">{money(c.totalCents, false)}</td>
                  <td className="num">{percent(c.share)}</td>
                  {hasIncome && <td className="num hide-phone">{percent(c.incomeShare ?? 0)}</td>}
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
        </table>
        {!r.groups.length && <div className="empty">Ei menoja valitulla jaksolla.</div>}
      </div>
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
