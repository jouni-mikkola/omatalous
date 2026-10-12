/**
 * Decision: which card of the household is which, at a glance. The picture of a credit card on Yhteenveto, drawn by the
 * app in CSS and two small SVGs at a real card's proportions: the bank at the top left (its logo when the app has one,
 * else its name), the chip and a contactless sign, the last four digits and the tone's word at the bottom. The tone comes
 * from the card's own name (`cardTone`); it is not a bank's artwork and copies none. The face is for the eye alone: the
 * name, the number and the figures are the text beside it.
 */
import type { DashboardData } from "../../types.ts";
import { BankLogo } from "../BankLogo.tsx";
import { cardTone, type CardTone } from "./holding-rows.ts";

type Card = DashboardData["holdings"]["cards"][number];

/** The word at the bottom right, in spaced capitals; a plain card has none. */
const WORD: Record<CardTone, string> = { gold: "GOLD", platinum: "PLATINUM", black: "BLACK", silver: "SILVER", plain: "" };

/** `logo`: the bank's picture, when the app has one. */
export function CardFace({ card, logo }: { card: Pick<Card, "name" | "bank" | "mask">; logo: string | null }) {
  const tone = cardTone(card.name);
  const last4 = card.mask?.trim().slice(-4);
  const word = WORD[tone];
  return (
    <div className={`card-face card-face-${tone}`} aria-hidden="true">
      <div className="card-face-top">{logo ? <BankLogo src={logo} name={card.bank ?? ""} size="sm" /> : card.bank && <span className="card-face-bank">{card.bank}</span>}</div>
      <div className="card-face-mid">
        <span className="card-chip">
          <svg width="20" height="15" viewBox="0 0 20 15" focusable="false">
            <path d="M0 5h20M0 10h20M10 0v15" />
          </svg>
        </span>
        <svg className="card-contactless" width="11" height="14" viewBox="0 0 11 14" focusable="false">
          <path d="M1.5 4.8q1.6 2.2 0 4.4M4.5 3q2.8 4 0 8M7.5 1.2q4 5.8 0 11.6" />
        </svg>
      </div>
      {(last4 || word) && (
        <div className="card-face-bottom">
          {last4 && <span className="card-face-mask">{`•••• ${last4}`}</span>}
          {word && <span className="card-face-tone">{word}</span>}
        </div>
      )}
    </div>
  );
}
