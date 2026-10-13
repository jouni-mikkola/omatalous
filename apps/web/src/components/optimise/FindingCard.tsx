/** One finding: the title, the action, the euros a year with their range or the deadline, the certainty when it is not high, and what to do next. */
import type { Finding, IsoDate } from "@banking/core";
import { useId, useState } from "react";
import { date, money } from "../../format.ts";
import { Figure } from "../Figure.tsx";
import type { Scope } from "../../types.ts";
import { Evidence } from "./Evidence.tsx";
import { FindingActions } from "./FindingActions.tsx";
import { type Changed, rangeText } from "./shared.tsx";

const CERTAINTY_BADGE = { korkea: "good", keskitaso: "", matala: "warn" } as const;

export function FindingCard({ finding: f, today, scope, onChanged }: { finding: Finding; today: IsoDate; scope: Scope; onChanged: Changed }) {
  const titleId = useId();
  const [open, setOpen] = useState(false);
  const range = f.euros ? rangeText(f.euros) : null;
  return (
    <article className="finding" aria-labelledby={titleId}>
      <div className="finding-top">
        <div className="finding-main">
          <p className="finding-title" id={titleId}>
            {f.title}
            {f.reopened && <span className="badge warn">Palasi, koska arvio nousi</span>}
          </p>
          <p className="finding-action">{f.action}</p>
          {/* a deadline with no euros says itself on the money side */}
          {f.decideBy && f.euros && <p>Määräaika {date(f.decideBy)}</p>}
        </div>
        <div className="finding-money">
          {f.euros ? (
            <>
              <strong className="finding-euros"><Figure text={`${money(f.euros.midCents, false)} vuodessa`} size="s" /></strong>
              {range && <span className="finding-range">Vaihteluväli {range}</span>}
            </>
          ) : (
            <strong className="finding-euros"><Figure text={`Määräaika ${date(f.decideBy)}`} size="s" /></strong>
          )}
        </div>
      </div>
      {f.certainty.level !== "korkea" && (
        <p className="finding-certainty">
          <span className={`badge ${CERTAINTY_BADGE[f.certainty.level]}`}>Varmuus: {f.certainty.level}</span> {f.certainty.reason}
        </p>
      )}
      <FindingActions finding={f} describedBy={titleId} today={today} scope={scope} open={open} onToggleOpen={() => setOpen((o) => !o)} onChanged={onChanged} />
      {open && <Evidence id={f.id} scope={scope} />}
    </article>
  );
}
