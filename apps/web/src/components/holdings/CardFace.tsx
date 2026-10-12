/**
 * Decision: how much of each card's limit is used and how much is free, before the household spends on it. The face is
 * drawn in CSS at a real card's proportions, with the bank's logo, the card's name and the mask as the bank gave it. The
 * bar under it is the picture the figures beside it explain. No bank's artwork: the look comes from the card's tier.
 */
import { money } from "../../format.ts";
import type { DashboardData } from "../../types.ts";
import { BankLogo } from "../BankLogo.tsx";
import { barPercent, cardTier } from "./card-tier.ts";

type Card = DashboardData["holdings"]["cards"][number];

/** The figures under the face, as the card holds them: used, limit and free, or only the debt when it has no limit. */
function Use({ card }: { card: Card }) {
  const { usedCents: used, limitCents: limit, freeCents: free, overCents } = card;
  if (limit === null) {
    if (used === null) return <div className="card-use-line muted">Saldo puuttuu</div>;
    return used === 0 ? <div className="card-use-line muted">Ei velkaa</div> : <div className="card-use-line"><span>Velkaa <strong>{money(used)}</strong></span></div>;
  }
  const percent = used === null ? null : barPercent(used, limit);
  const over = overCents !== null && overCents > 0;
  return (
    <>
      <div className="card-use-line">
        {used === null ? <span className="muted">Saldo puuttuu</span> : <span>Käytössä <strong>{money(used)}</strong></span>}
        <span className="muted">Luottoraja {money(limit)}</span>
      </div>
      {percent !== null && (
        <svg className={over ? "card-meter over" : "card-meter"} width="100%" height="8" aria-hidden="true" focusable="false">
          <rect className="card-meter-track" width="100%" height="8" rx="4" />
          <rect className="card-meter-used" width={`${percent}%`} height="8" rx="4" />
        </svg>
      )}
      {over ? <div className="card-use-line card-over">Yli luottorajan</div> : free !== null && <div className="card-use-line muted">Vapaana {money(free)}</div>}
    </>
  );
}

/** `logo`: the bank's picture, when the app has one. `since`: the line that tells when an old balance was given. */
export function CardFace({ card, logo, since }: { card: Card; logo: string | null; since: string | null }) {
  return (
    <li className="holding-card">
      <div className={`card-face card-face-${cardTier(card.name)}`}>
        <div className="card-face-top">{logo ? <BankLogo src={logo} name={card.bank ?? ""} size="sm" /> : card.bank && <span className="card-face-bank" title={card.bank}>{card.bank}</span>}</div>
        <div>
          {card.mask && <div className="card-face-mask">{card.mask}</div>}
          <div className="card-face-name" title={card.name}>{card.name}</div>
        </div>
      </div>
      <div className="card-use">
        <Use card={card} />
        {since && <div className="card-use-line small muted">{since}</div>}
      </div>
    </li>
  );
}
