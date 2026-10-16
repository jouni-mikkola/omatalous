import { useState } from "react";
import { date, money } from "../../format.ts";
import type { Recurring as Series } from "../../types.ts";
import { ContractPanel } from "./ContractPanel.tsx";

/** One ended contract: its name, the days it ran and what it cost in the end (the refund taken off); the range opens the contract's own lines. */
function EndedRow({ s }: { s: Series & { contract: NonNullable<Series["contract"]> } }) {
  const [open, setOpen] = useState(false);
  const c = s.contract;
  return (
    <div className="st-row">
      <dt className="st-name">
        <a href={`#/transactions?merchant=${encodeURIComponent(s.merchant)}`}>{s.merchant}</a>
        <div>
          <button type="button" className="contract-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
            {date(c.startDate)}–{date(c.lastDate)}
          </button>
        </div>
      </dt>
      <dd className="st-num">Yhteensä {money(c.costAfterRefundCents)}</dd>
      {open && (
        <div className="contract-panel">
          <ContractPanel contract={c} endedByUser={!c.ended} />
        </div>
      )}
    </div>
  );
}

/** The contracts that ended in the last two years. Not in the totals of the blocks above: they cost nothing any more. */
export function EndedContracts({ rows }: { rows: Series[] }) {
  if (!rows.length) return null;
  return (
    <div className="card">
      <div className="card-head tb">
        <div className="card-name">
          <h2>Päättyneet sopimukset</h2>
        </div>
      </div>
      <dl className="st-rows">
        {rows.map((s) => (
          <EndedRow key={s.id} s={s as Series & { contract: NonNullable<Series["contract"]> }} />
        ))}
      </dl>
    </div>
  );
}
