// Decision: where to cut
import { query } from "../../../api.ts";
import { money, percent, roundedShares, shareText, signedMoney } from "../../../format.ts";
import { addsUpPrinted } from "../../../marks.ts";
import { ExportLink, NEGATIVE_TOTAL_NOTE } from "../parts.tsx";
import { Why } from "../../../components/Why.tsx";
import { Section } from "../../../components/Section.tsx";
import { UnknownShare } from "../../../components/UnknownShare.tsx";
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
  // the groups are the parts of the printed Yhteensä: the bracket stands only when the euros printed add up to it
  const sums = addsUpPrinted(r.groups.map((g) => g.totalCents), r.totalCents);
  const lastGroup = r.groups.length - 1;
  // the shares are of the categories that net above zero (core's base). Rounded together, the groups add up to the
  // 100 % they are parts of, and the categories of a group to the share their group prints
  const base = r.groups.reduce((s, g) => g.categories.reduce((t, c) => t + Math.max(0, c.totalCents), s), 0);
  const groupUnits = roundedShares(r.groups.map((g) => g.totalCents), base);
  const categoryUnits = r.groups.map((g, gi) => {
    const own = g.categories.reduce((s, c) => s + c.totalCents, 0) === g.totalCents && groupUnits[gi] != null ? groupUnits[gi]! : undefined;
    return roundedShares(g.categories.map((c) => c.totalCents), base, 0, own);
  });
  const text = (units: number | null | undefined) => (units == null ? "–" : shareText(units));
  return (
    <Section id={section.id} title={section.title} half sub={r.comparable ? "Muutos edellisestä jaksosta" : undefined} actions={<ExportLink href={ctx.exportHref("categories")} />}>
      <UnknownShare share={ctx.data.cashflow.unknownShare} />
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
                <td className="num">{text(groupUnits[gi])}</td>
                {hasAverage && <td className="num hide-phone">{money(g.categories.reduce((s, c) => s + (c.monthlyAvgCents ?? 0), 0), false)}</td>}
                {r.comparable && (
                  <td className="num">
                    <Change now={g.comparedCents} before={g.previousCents} />
                  </td>
                )}
              </tr>,
              ...g.categories.map((c, ci) => (
                <tr key={c.category}>
                  <td style={{ paddingLeft: 20 }}>
                    <a href={`#/transactions${query({ category: c.category, from: range.from, to: range.to })}`}>{c.label}</a>
                  </td>
                  <td className={`num${sums ? " sum-pad" : ""}`}>
                    <Why figure="spend.category" title={c.label} range={range} scope={ctx.scope} category={c.category} text={money(c.totalCents, false)}>
                      {money(c.totalCents, false)}
                    </Why>
                  </td>
                  <td className="num">{text(categoryUnits[gi]![ci])}</td>
                  {hasAverage && <td className="num hide-phone">{c.monthlyAvgCents === null ? "–" : money(c.monthlyAvgCents, false)}</td>}
                  {r.comparable && (
                    <td className="num">
                      <Change now={c.comparedCents} before={c.previousCents} />
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
                <td className={`num${sums ? " sum-pad" : ""}`}>
                  <Why figure="spend.month" title="Menot yhteensä" range={range} scope={ctx.scope} text={money(r.totalCents, false)}>
                    {money(r.totalCents, false)}
                  </Why>
                </td>
                <td className="num">{percent(r.totalCents ? 1 : 0)}</td>
                {hasAverage && <td className="num hide-phone">{money(r.groups.reduce((s, g) => s + g.categories.reduce((t, c) => t + (c.monthlyAvgCents ?? 0), 0), 0), false)}</td>}
                {r.comparable && (
                  <td className="num">
                    <Change now={r.comparedTotalCents} before={r.previousTotalCents} />
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
  // the unknown share is the cash flow report's, which the page asks for anyway
  reports: ["categories", "cashflow"],
  Component: Categories,
};
