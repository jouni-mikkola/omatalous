/**
 * Asetukset > Tilit, under a joint account: "Maksut ja menot kuukausittain". For each month with a booked row, newest first,
 * a column for each member and one for the rest, and what each paid in, bore of the costs, moved away and took of the
 * others' money, and what is left of whose. The server adds it up from the account's trace; this only draws it. The
 * newest month is open, the older ones open with their name; the newest six are listed, the rest behind "Näytä lisää".
 */
import { monthEnd } from "@banking/core";
import { type CSSProperties, useEffect, useId, useRef, useState } from "react";
import { query } from "../../api.ts";
import { money, monthLong } from "../../format.ts";
import { useApi } from "../../hooks.ts";
import type { Account, Meta } from "../../types.ts";
import { Table } from "../../components/table/Table.tsx";
import { toggled } from "../../components/toggled.ts";
import { useMore } from "../../components/More.tsx";
import "../../styles/statement.css";
import "../../styles/themes-table.css";
import "../../styles/account-sources.css";

/** The answer of GET /accounts/:id/sources. A column with no `userId` is the holder who has no login (`holder`) or every part no member owns. */
type Column = { userId: string | null; holder?: true; paidInCents: number; costsCents: number; movedCents: number; takenCents: number; leftCents: number };
interface Sources {
  months: {
    month: string;
    columns: Column[];
  }[];
}
type Figure = "paidInCents" | "costsCents" | "movedCents" | "takenCents" | "leftCents";

/** The rows of a month's table; the balance links nowhere. */
const ROWS: { label: string; figure: Figure; linked: boolean }[] = [
  { label: "Maksettu tilille", figure: "paidInCents", linked: true },
  { label: "Menot", figure: "costsCents", linked: true },
  { label: "Siirretty tililtä", figure: "movedCents", linked: true },
  { label: "Omat tilisiirrot", figure: "takenCents", linked: true },
  { label: "Saldo kuun lopussa", figure: "leftCents", linked: false },
];
/** How many of the newest months are open when the page opens. */
const OPEN_MONTHS = 1;
/** How many of the newest months are listed before "Näytä lisää". */
const MONTHS_LISTED = 6;
const NOBODY = "Ei tiedossa";

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Whether an account is a pool (two users or more), the only kind that has these months. */
export const hasSources = (a: Account): boolean => (a.use?.users.length ?? 0) >= 2;

/** A figure: nothing is a dash. */
function Amount({ cents, href }: { cents: number; href: string | null }) {
  return <>{cents === 0 ? "–" : href ? <a href={href}>{money(cents)}</a> : money(cents)}</>;
}

/** The row an account's months go in: it draws nothing while they are on their way and for an account with no trace. */
export function AccountSources({ account, meta }: { account: Account; meta: Meta }) {
  const heading = useId();
  const { data, reload } = useApi<Sources>(`/api/accounts/${encodeURIComponent(account.id)}/sources`);
  // the page was changed (an answer, a sync): ask again, but not twice on the way in
  const first = useRef(true);
  useEffect(() => {
    if (first.current) first.current = false;
    else reload();
  }, [meta, reload]);
  // the months the reader opened or closed; the others are open by their place
  const [flipped, setFlipped] = useState<ReadonlySet<string>>(new Set());
  // a month's toggle each since the account began is years of lines under every joint account
  const { shown: months, more } = useMore(data?.months ?? [], MONTHS_LISTED);
  if (!data?.months.length) return null;
  // the holder with no login is named as the account's use names them
  const nameOf = (c: Column) =>
    c.holder ? (account.use?.users.find((u) => u.userId === null)?.label ?? "") : c.userId === null ? NOBODY : (meta.members.find((m) => m.id === c.userId)?.displayName ?? (meta.user.id === c.userId ? meta.user.displayName : ""));
  const keyOf = (c: Column) => c.userId ?? (c.holder ? "holder" : "rest");
  return (
    <tr className="edit-row">
      <td colSpan={99}>
        {/* a group, not a region: one such landmark per account repeated under the same name */}
        <div className="acc-src" role="group" aria-labelledby={heading}>
          <h3 id={heading} className="st-cap">
            Tilille tullut ja lähtenyt raha kuukausittain
          </h3>
          {months.map((m, i) => {
            const open = (i < OPEN_MONTHS) !== flipped.has(m.month);
            const names = m.columns.map(nameOf);
            const rows = `#/transactions${query({ accountId: account.id, from: `${m.month}-01`, to: monthEnd(m.month) })}`;
            return (
              <div key={m.month} className="acc-src-month">
                <button type="button" className="themes-toggle acc-src-toggle" aria-expanded={open} onClick={() => setFlipped((f) => toggled(f, m.month))}>
                  <span className="themes-label">{capital(monthLong(m.month))}</span>
                </button>
                {open && (
                  <div style={{ "--src-cols": m.columns.length } as CSSProperties}>
                    <Table<(typeof ROWS)[number]>
                      caption={`${capital(monthLong(m.month))}: tilille tullut ja lähtenyt raha`}
                      rows={[...ROWS]}
                      rowKey={(r) => r.figure}
                      columns={[
                        { key: "label", label: "Erä", headHidden: true, kind: "text", rowHead: true, cell: (r) => r.label },
                        ...m.columns.map((c, k) => ({
                          key: keyOf(c),
                          label: names[k]!,
                          kind: "money" as const,
                          cell: (r: (typeof ROWS)[number]) => <Amount cents={c[r.figure]} href={r.linked ? rows : null} />,
                        })),
                      ]}
                      className="acc-src-table"
                      rowClassName={(r) => (r.figure === "leftCents" ? "acc-src-end" : undefined)}
                    />
                  </div>
                )}
              </div>
            );
          })}
          {more}
        </div>
      </td>
    </tr>
  );
}
