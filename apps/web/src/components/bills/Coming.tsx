// Decision: how much to keep in the account for the bills before the pay, and for the ones after it
import type { AheadGroup } from "@banking/core";
import { useState } from "react";
import { dayMonth, money } from "../../format.ts";
import type { DashboardData } from "../../types.ts";
import { addsUp } from "../../marks.ts";
import { Figure } from "../Figure.tsx";
import { MerchantAvatar } from "../MerchantAvatar.tsx";
import { Estimate } from "../Why.tsx";
import { isEstimate, isPayment, type Payment, windowLine } from "../next-days.ts";
import { PendingPayee } from "../PendingPayee.tsx";
import { type Column, DataTable } from "../table/DataTable.tsx";
import { BillForm } from "./BillForm.tsx";

/** The window as GET /api/ahead sends it: with Laskut's groups and their sums. */
type Ahead = NonNullable<DashboardData["ahead"]> & { groups: AheadGroup[] };

/** Each group's heading; the list is grouped and summed by the server (core `AheadGroup`). */
function titleOf(key: AheadGroup["key"], ahead: Ahead): string {
  if (key === "window") return windowLine(ahead);
  if (key === "after") return "Palkkapäivän jälkeen";
  if (key === "card") return "Kortilta veloitettavat";
  return "Seuraavat 30 päivää";
}

/**
 * The list in the groups of the window of Yhteenveto: what the accounts pay to the window's last day, the day before
 * the pay, under the line Yhteenveto has under its heading, then what they pay after it. So the first group's sum is the
 * bills of "Erääntyvät maksut" on Yhteenveto, which adds to them only an own transfer. What a credit card is charged
 * leaves no account: it is the last group. The groups, their rows and their sums are the answer's (`ahead.groups`).
 */
function groupsOf(ahead: Ahead): { title: string; rows: Payment[]; cents: number }[] {
  return ahead.groups.map((g) => ({ title: titleOf(g.key, ahead), rows: g.rows.map((i) => ahead.upcoming[i]!).filter(isPayment), cents: g.cents }));
}

const COLUMNS: Column<Payment>[] = [
  { key: "date", label: "Eräpäivä", kind: "date", className: () => "due-col", cell: (r) => dayMonth(r.date) },
  {
    key: "name",
    label: "Saaja",
    kind: "text",
    cell: (r) => (
      <span className="coming-payee">
        <MerchantAvatar name={r.name} person={false} size="s" />
        {r.source === "expected" ? (
          <>
            {r.name} <span className="badge">lisätty käsin</span>
          </>
        ) : r.pending ? (
          <PendingPayee>{r.name}</PendingPayee>
        ) : (
          r.name
        )}
      </span>
    ),
  },
  {
    key: "cents",
    label: "Summa",
    kind: "money",
    className: (r) => (isEstimate(r) ? "st-num coming-est" : "st-num"),
    cell: (r) => <Estimate when={isEstimate(r)}>{money(-r.cents)}</Estimate>,
  },
];

/**
 * Erääntyvät maksut on Laskut: the one list of what is charged in the next 30 days, to an account or to a credit card,
 * whether the bank history shows it every month, rarely, or the household typed it in. It is `upcoming` of the dashboard answer, found by the
 * same code as the rows of the block of the same name on Yhteenveto, and grouped by that block's window, each group with
 * its sum. Every row of the 30 days is listed, as a day, a payee and a sum under the heads of the table of Yhteenveto.
 * "Lisää lasku" opens the form for a bill the history cannot know yet.
 */
export function Coming({ ahead, today, onAdded }: { ahead: Ahead | null; today: string; onAdded: () => void }) {
  const [adding, setAdding] = useState(false);
  const [added, setAdded] = useState<string | null>(null);
  const groups = ahead && ahead.upcoming.length > 0 ? groupsOf(ahead) : [];

  return (
    <div className="card" id="tulossa">
      <div className="card-head tb">
        <div className="card-name">
          <h2>Erääntyvät maksut</h2>
        </div>
        <div className="card-tool">
          <button
            className="btn btn-small"
            type="button"
            aria-expanded={adding}
            onClick={() => {
              setAdding((v) => !v);
              setAdded(null);
            }}
          >
            {adding ? "Peruuta" : "Lisää lasku"}
          </button>
        </div>
      </div>
      {adding && (
        <BillForm
          today={today}
          onAdded={(name) => {
            setAdding(false);
            setAdded(name);
            onAdded();
          }}
        />
      )}
      {added && (
        <p className="small muted" role="status">
          Lasku {added} lisätty.
        </p>
      )}
      {groups.length === 0 ? (
        <p className="small muted">Ei laskuja seuraavan 30 päivän aikana.</p>
      ) : (
        <DataTable<Payment>
          id="coming"
          caption="Maksut, jotka erääntyvät seuraavan 30 päivän aikana"
          rows={groups.flatMap((g) => g.rows)}
          rowKey={(r) => `${r.date}-${r.name}-${r.cents}`}
          columns={COLUMNS}
          phone="none"
          plain
          className="st-table coming-table"
          colgroup={["due-col", "", ""]}
          groups={groups.map((g) => {
            const sum = g.cents;
            return {
              key: g.title,
              title: g.title,
              figure: (
                <Estimate when={g.rows.some(isEstimate)}>
                  <Figure text={money(sum)} size="s" />
                </Estimate>
              ),
              rows: g.rows,
              // the sum stands above its rows: the bracket runs up into the head's rule only when they add up to it
              adds: addsUp(g.rows.map((r) => -r.cents), sum),
            };
          })}
          sums={["cents"]}
        />
      )}
    </div>
  );
}
