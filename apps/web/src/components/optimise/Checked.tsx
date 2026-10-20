/** Tarkistettu: every check that found nothing to report, in the order of the areas, in three groups by what became of it. A finding is a card, not a row. */
import { AREA_IDS, type AreaView, type Check } from "@banking/core";
import { money } from "../../format.ts";
import { Section } from "../Section.tsx";
import { CheckSegments, checkCounts } from "./Lead.tsx";
import { AreaMark } from "./marks.tsx";

const WORD: Record<Exclude<Check["status"], "finding">, string> = {
  clear: "Ei huomautettavaa",
  needs_input: "Tietoja puuttuu",
  no_data: "Tapahtumia liian lyhyeltä ajalta",
  no_rows: "Ei tapahtumia",
  no_subject: "Ei tarkistettavaa",
};

type Row = Check & { status: Exclude<Check["status"], "finding">; area: AreaView["id"] };

/** The three groups of Tarkistettu, each a sign and a heading: the sign says it without the colour. */
const GROUPS = [
  { id: "clear", title: "Kunnossa", sign: "✓", has: (s: Row["status"]) => s === "clear" },
  { id: "waiting", title: "Tietoja puuttuu", sign: "◷", has: (s: Row["status"]) => s === "needs_input" || s === "no_data" },
  { id: "none", title: "Ei tarkistettavaa", sign: "–", has: (s: Row["status"]) => s === "no_rows" || s === "no_subject" },
] as const;

/**
 * Decision: whether to trust the page's silence: what was looked at and found in order, and what waits for a number
 * the household can give. The figures stay empty until an area fills `cents` or `count` of its checks. A household
 * with too few months (`young`) has nothing checked yet, so nothing is printed.
 */
export function Checked({ areas, young }: { areas: readonly AreaView[]; young: boolean }) {
  const rows: Row[] = [];
  for (const id of AREA_IDS) for (const c of areas.find((a) => a.id === id)?.checks ?? []) if (c.status !== "finding") rows.push({ ...c, status: c.status, area: id });
  if (young || !rows.length) return null;
  const counts = checkCounts({ areas: [...areas] });
  return (
    <Section id="tarkistettu" title="Mitä tarkistettiin?">
      <CheckSegments counts={counts} labelled />
      <div className="checked-groups">
        {GROUPS.map((g) => {
          const here = rows.filter((r) => g.has(r.status));
          if (!here.length) return null;
          return (
            <div key={g.id} className={`checked-group checked-${g.id}`}>
              <h3>
                <span className="checked-sign" aria-hidden="true">{g.sign}</span>
                {g.title} <span className="rt-group-count">{here.length}</span>
              </h3>
              <ul>
                {here.map((c) => (
                  <li key={c.id}>
                    <AreaMark id={c.area} size={20} />
                    <span className="checked-label">{c.label}</span>
                    {c.cents !== undefined && <span className="checked-cents">{money(c.cents)} kuussa</span>}
                    {c.count && <span className="checked-count">{c.count.n} {c.count.noun}</span>}
                    {g.id === "waiting" && <span className="checked-why">{c.status === "needs_input" && c.input ? <a href="#/review">Täydennä</a> : WORD[c.status]}</span>}
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </Section>
  );
}
