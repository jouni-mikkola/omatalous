/** Tarkistettu: one row for every check that found nothing to report, in the order of the areas, with one word for what became of it. A finding is a card, not a row. */
import { AREA_IDS, type AreaView, type Check } from "@banking/core";
import { money } from "../../format.ts";
import { Section } from "../Section.tsx";

const WORD: Record<Exclude<Check["status"], "finding">, string> = {
  clear: "Ei huomautettavaa",
  needs_input: "Tietoja puuttuu",
  no_data: "Tapahtumia liian lyhyeltä ajalta",
  no_rows: "Ei tapahtumia",
};

/** The checks to list: those that are not a finding, the areas in their own order, not the page's order by weight. */
function checkedRows(areas: readonly AreaView[]): (Check & { status: Exclude<Check["status"], "finding"> })[] {
  const out: (Check & { status: Exclude<Check["status"], "finding"> })[] = [];
  for (const id of AREA_IDS) {
    for (const c of areas.find((a) => a.id === id)?.checks ?? []) if (c.status !== "finding") out.push({ ...c, status: c.status });
  }
  return out;
}

/**
 * The two columns of figures stay empty until an area fills `cents` or `count` of its checks. A household with too few
 * months (`young`) has nothing checked yet, so nothing is printed.
 */
export function Checked({ areas, young }: { areas: readonly AreaView[]; young: boolean }) {
  const rows = checkedRows(areas);
  if (young || !rows.length) return null;
  const hasCents = rows.some((c) => c.cents !== undefined);
  return (
    <Section id="tarkistettu" title="Tarkistettu">
      <table className="ruled checked">
        {hasCents && (
          <thead>
            <tr>
              <th scope="col" />
              <th scope="col" className="num">Kuukaudessa</th>
              <th scope="col" />
              <th scope="col" />
            </tr>
          </thead>
        )}
        <tbody>
          {rows.map((c) => (
            <tr key={c.id}>
              <th scope="row" className="checked-label">{c.label}</th>
              <td className="num checked-cents">{c.cents !== undefined ? money(c.cents) : null}</td>
              <td className="checked-count">{c.count ? `${c.count.n} ${c.count.noun}` : null}</td>
              <td className="checked-status">
                {WORD[c.status]}
                {c.status === "needs_input" && c.input && (
                  <>
                    {" "}
                    <a href="#/optimise#tiedot">Täydennä</a>
                  </>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Section>
  );
}
