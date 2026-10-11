/** Muutokset viime käynnin jälkeen: findings that appeared, grew or shrank 25 % or more, or left the data since the last month's snapshot. */
import type { AreaView, ChangeKind, FindingChange } from "@banking/core";
import { money, monthLong } from "../../format.ts";
import { Section } from "../Section.tsx";
import { nameOf } from "./shared.tsx";

const KIND: Record<ChangeKind, string> = { new: "Uusi", grown: "Kasvoi", shrunk: "Pieneni", resolved: "Poistui" };

const yearly = (cents: number) => `${money(cents, false)} vuodessa`;

function detail(c: FindingChange): string {
  if (c.change === "resolved") return c.previousCents !== null ? `Ei enää näy tiedoissa, oli ${yearly(c.previousCents)}` : "Ei enää näy tiedoissa";
  if (c.midCents === null) return "Määräaika";
  if (c.previousCents === null) return yearly(c.midCents);
  return `${money(c.previousCents, false).replace(/\s€$/, "")} → ${yearly(c.midCents)}`;
}

/** "syyskuussa 2026": every Finnish month name ends in -kuu. */
const inMonth = (month: string) => monthLong(month).replace(/^(\S+)/, "$1ssa");

/** `since` is the month of the snapshot compared with, which may be months back when the page was not visited. */
export function Changes({ changes, since, areas, titles }: { changes: readonly FindingChange[]; since: string | null; areas: readonly AreaView[]; titles: ReadonlyMap<string, string> }) {
  if (!changes.length) return null;
  return (
    <Section id="muutokset" title="Muutokset viime käynnin jälkeen" sub={since ? `Verrattuna tilanteeseen ${inMonth(since)}` : undefined}>
      <ul className="decided-list">
        {changes.map((c) => (
          <li key={c.id} className="decided">
            <div className="decided-text">
              <span className="decided-title">{titles.get(c.id) ?? nameOf(c.id, areas)}</span>
              <span className="small muted">{detail(c)}</span>
            </div>
            <span className={`badge ${c.change === "grown" ? "warn" : c.change === "new" ? "" : "good"}`}>{KIND[c.change]}</span>
          </li>
        ))}
      </ul>
    </Section>
  );
}
