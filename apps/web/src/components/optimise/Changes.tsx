/** Muutokset viime käynnin jälkeen: findings that appeared, grew or shrank 25 % or more, or left the data since the last month's snapshot. */
import type { AreaView, ChangeKind, FindingChange } from "@banking/core";
import { money, monthLongIn } from "../../format.ts";
import { t } from "../../text.ts";
import { Section } from "../Section.tsx";
import { nameOf } from "./shared.tsx";

const KIND = { new: "ow.kind_new", grown: "ow.kind_grown", shrunk: "ow.kind_shrunk", resolved: "ow.kind_resolved" } as const satisfies Record<ChangeKind, string>;

const yearly = (cents: number) => t("opt.loan_a_year", { eur: money(cents, false) });

function detail(c: FindingChange): string {
  if (c.change === "resolved") return c.previousCents !== null ? t("ow.ch_gone_was", { amount: yearly(c.previousCents) }) : t("ow.ch_gone");
  if (c.midCents === null) return t("ow.ch_deadline");
  if (c.previousCents === null) return yearly(c.midCents);
  return `${money(c.previousCents, false).replace(/\s€$/, "")} → ${yearly(c.midCents)}`;
}

/** `since` is the month of the snapshot compared with, which may be months back when the page was not visited. */
export function Changes({ changes, since, areas, titles }: { changes: readonly FindingChange[]; since: string | null; areas: readonly AreaView[]; titles: ReadonlyMap<string, string> }) {
  if (!changes.length) return null;
  return (
    <Section id="muutokset" title={t("ow.ch_title")} sub={since ? t("ow.ch_since", { month: monthLongIn(since) }) : undefined}>
      <ul className="decided-list">
        {changes.map((c) => (
          <li key={c.id} className="decided">
            <div className="decided-text">
              <span className="decided-title">{titles.get(c.id) ?? nameOf(c.id, areas)}</span>
              <span className="small muted">{detail(c)}</span>
            </div>
            <span className={`badge ${c.change === "grown" ? "warn" : c.change === "new" ? "" : "good"}`}>{t(KIND[c.change])}</span>
          </li>
        ))}
      </ul>
    </Section>
  );
}
