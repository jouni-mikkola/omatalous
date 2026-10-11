/** One finding: the title, the action with its effort and date, the euros a year with their range, the certainty and what to do next. */
import type { Finding, IsoDate } from "@banking/core";
import { useId, useState } from "react";
import { date, money } from "../../format.ts";
import type { Scope } from "../../types.ts";
import { Evidence } from "./Evidence.tsx";
import { FindingActions } from "./FindingActions.tsx";
import { type Changed, EFFORT_TEXT, rangeText } from "./shared.tsx";

const CERTAINTY_BADGE = { korkea: "good", keskitaso: "", matala: "warn" } as const;

export function FindingCard({ finding: f, today, scope, onChanged }: { finding: Finding; today: IsoDate; scope: Scope; onChanged: Changed }) {
  const titleId = useId();
  const [open, setOpen] = useState(false);
  const range = f.euros ? rangeText(f.euros) : null;
  // the headline leaves these out, so the card says so
  const apart = f.shared ? "Päätetään yhdessä muiden kanssa, ei mukana yhteissummassa." : f.certainty.level === "matala" ? "Ei mukana yhteissummassa." : null;
  return (
    <article className="finding" aria-labelledby={titleId}>
      <div className="finding-top">
        <div className="finding-main">
          <p className="finding-title" id={titleId}>
            {f.title}
            {f.reopened && <span className="badge warn">Palasi, koska arvio nousi</span>}
          </p>
          <p className="finding-action">{f.action}</p>
          <p className="small muted">
            {EFFORT_TEXT[f.effort]}
            {f.decideBy && `, määräaika ${date(f.decideBy)}`}
          </p>
        </div>
        <div className="finding-money">
          {f.euros ? (
            <>
              <strong className="finding-euros">{money(f.euros.midCents, false)} vuodessa</strong>
              {range && <span className="finding-range">Vaihteluväli {range}</span>}
              <span className="small muted">{f.euros.assumption}</span>
            </>
          ) : (
            <strong className="finding-euros">Määräaika {date(f.decideBy)}</strong>
          )}
        </div>
      </div>
      <p className="finding-certainty small">
        <span className={`badge ${CERTAINTY_BADGE[f.certainty.level]}`}>Varmuus: {f.certainty.level}</span> <span className="muted">{f.certainty.reason}</span>
        {apart && <span className="muted"> {apart}</span>}
      </p>
      <FindingActions finding={f} describedBy={titleId} today={today} scope={scope} open={open} onToggleOpen={() => setOpen((o) => !o)} onChanged={onChanged} />
      {open && <Evidence id={f.id} scope={scope} />}
    </article>
  );
}
