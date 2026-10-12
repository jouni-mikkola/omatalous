/**
 * Decision: how much of each credit card's limit is used and how much is free, before the household spends on it. A card
 * is one row: a small face at the left, drawn in CSS and one SVG at a real card's proportions, and at the right the card's
 * name and its figures. The face is for the eye alone (the text says all of it), and the meter under the figures is the
 * picture they explain. No bank's artwork: the look comes from the card's tier.
 */
import { money } from "../../format.ts";
import type { DashboardData } from "../../types.ts";
import { BankLogo } from "../BankLogo.tsx";
import { barPercent, cardName, cardTier } from "./card-tier.ts";
import { FigureRow } from "./FigureRow.tsx";

type Card = DashboardData["holdings"]["cards"][number];

/** The figures under the name, as the card holds them: used, limit and free, or only what is used when it has no limit. */
function Use({ card }: { card: Card }) {
  const { usedCents: used, limitCents: limit, freeCents: free, overCents } = card;
  const usedFigure = <FigureRow label="Käytetty luotto">{used === null ? <span className="muted">Ei tiedossa</span> : money(used)}</FigureRow>;
  if (limit === null) return <dl className="holding-figures">{usedFigure}</dl>;
  const percent = used === null ? null : barPercent(used, limit);
  const over = overCents !== null && overCents > 0 ? overCents : null;
  return (
    <>
      <dl className="holding-figures">
        {usedFigure}
        <FigureRow label="Luottoraja">{money(limit)}</FigureRow>
        {over !== null ? (
          <FigureRow label="Luottoraja ylitetty" warn>{money(over)}</FigureRow>
        ) : (
          free !== null && <FigureRow label="Käytettävissä">{money(free)}</FigureRow>
        )}
      </dl>
      {percent !== null && (
        <svg className={over !== null ? "card-meter over" : "card-meter"} width="100%" height="8" aria-hidden="true" focusable="false">
          <rect className="card-meter-track" width="100%" height="8" rx="4" />
          <rect className="card-meter-used" width={`${percent}%`} height="8" rx="4" />
        </svg>
      )}
    </>
  );
}

/** The picture of the card: the bank at the top left, the chip, the mask at the bottom left. */
function Face({ card, logo }: { card: Card; logo: string | null }) {
  return (
    <div className={`card-face card-face-${cardTier(card.name)}`} aria-hidden="true">
      <div className="card-face-top">{logo ? <BankLogo src={logo} name={card.bank ?? ""} size="sm" /> : card.bank && <span className="card-face-bank">{card.bank}</span>}</div>
      <svg className="card-chip" width="20" height="15" viewBox="0 0 20 15" focusable="false">
        <rect className="card-chip-body" width="20" height="15" rx="3" />
        <path className="card-chip-lines" d="M0 5h20M0 10h20M10 0v15" />
      </svg>
      {card.mask && <div className="card-face-mask">{card.mask}</div>}
    </div>
  );
}

/** `logo`: the bank's picture, when the app has one. `since`: the line that tells when an old balance was given. */
export function CardRow({ card, logo, since }: { card: Card; logo: string | null; since: string | null }) {
  return (
    <li className="holding-card">
      <Face card={card} logo={logo} />
      <div className="holding-card-text">
        <div className="holding-name">
          {cardName(card.name)}
          {card.mask && <span className="sr-only"> {card.mask}</span>}
        </div>
        <Use card={card} />
        {since && <div className="holding-sub">{since}</div>}
      </div>
    </li>
  );
}
