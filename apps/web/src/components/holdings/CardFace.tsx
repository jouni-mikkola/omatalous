/**
 * Decision: which card of the household is which, at a glance. The picture of a credit card on Yhteenveto, drawn by the
 * app in CSS and one small SVG at a real card's proportions: the bank at the top left (its logo when the app has one,
 * else its name), the chip, the last four digits and the tone's word at the bottom. The tone comes from the card's own
 * name (`cardTone`); it is not a bank's artwork and copies none. It is a link to the card's rows for a pointer, and the name beside it is the link for the
 * keyboard and a screen reader, so the picture itself is left out of both. The name, the number and the figures are the
 * text beside it.
 */
import type { DashboardData } from "../../types.ts";
import { BankLogo } from "../BankLogo.tsx";
import { cardTone, type CardTone } from "./holding-rows.ts";

type Card = DashboardData["holdings"]["cards"][number];

/** The word at the bottom right, in spaced capitals; a plain card has none. */
const WORD: Record<CardTone, string> = { gold: "GOLD", platinum: "PLATINUM", black: "BLACK", silver: "SILVER", plain: "" };

/** `bank`: the bank the face shows (`cardBankOf`), with its picture when the app has one. `href`: the card's rows in Tapahtumat. */
export function CardFace({ card, bank, href }: { card: Pick<Card, "name" | "mask">; bank: { bank: string; src: string | null } | null; href: string }) {
  const tone = cardTone(card.name);
  const last4 = card.mask?.trim().slice(-4);
  const word = WORD[tone];
  return (
    <a className="card-face-link" href={href} tabIndex={-1} aria-hidden="true">
      <div className={`card-face card-face-${tone}`}>
        <div className="card-face-top">{bank?.src ? <BankLogo src={bank.src} name={bank.bank} size="sm" decorative /> : bank?.bank && <span className="card-face-bank">{bank.bank}</span>}</div>
        <span className="card-chip">
          <svg viewBox="0 0 34 26" focusable="false">
            <path d="M0 9h11v8H0M34 9H23v8h11M11 0v26M23 0v26M11 13h12" />
          </svg>
        </span>
        {(last4 || word) && (
          <div className="card-face-bottom">
            {last4 && <span className="card-face-mask">{`•••• ${last4}`}</span>}
            {word && <span className="card-face-tone">{word}</span>}
          </div>
        )}
      </div>
    </a>
  );
}
