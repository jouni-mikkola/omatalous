/**
 * Decision: which card of the household is which, at a glance. The picture of a credit card on Yhteenveto, drawn by the
 * app in CSS and one small SVG at a real card's proportions: the bank at the top left (its logo when the app has one,
 * else its name), the chip, the last four digits and the tone's word at the bottom. The tone comes from the card's own
 * name (`cardTone`); it is not a bank's artwork and copies none. The picture leans toward the pointer with a band of
 * light on it (`tiltAt`); it is a link to the card's rows for a pointer, and the name beside it is the link for the
 * keyboard and a screen reader, so the picture itself is left out of both. The name, the number and the figures are the
 * text beside it.
 */
import type { PointerEvent } from "react";
import type { DashboardData } from "../../types.ts";
import { BankLogo } from "../BankLogo.tsx";
import { STILL_QUERY, tiltAt } from "./card-tilt.ts";
import { cardTone, type CardTone } from "./holding-rows.ts";

type Card = DashboardData["holdings"]["cards"][number];

/** The word at the bottom right, in spaced capitals; a plain card has none. */
const WORD: Record<CardTone, string> = { gold: "GOLD", platinum: "PLATINUM", black: "BLACK", silver: "SILVER", plain: "" };

/** What the pointer sets on the picture, as custom properties of the face's CSS; all of it is dropped when the pointer leaves. */
const PROPERTY = { rx: "--face-rx", ry: "--face-ry", gx: "--face-gx" } as const;

function lean(e: PointerEvent<HTMLElement>) {
  const el = e.currentTarget;
  const tilt = tiltAt(e, el.getBoundingClientRect(), matchMedia(STILL_QUERY).matches);
  if (!tilt) return;
  for (const key of ["rx", "ry", "gx"] as const) el.style.setProperty(PROPERTY[key], String(tilt[key]));
  el.classList.add("card-face-tilt");
}

function level(e: PointerEvent<HTMLElement>) {
  e.currentTarget.classList.remove("card-face-tilt");
  for (const property of Object.values(PROPERTY)) e.currentTarget.style.removeProperty(property);
}

/** `logo`: the bank's picture, when the app has one. `href`: the card's rows in Tapahtumat. */
export function CardFace({ card, logo, href }: { card: Pick<Card, "name" | "bank" | "mask">; logo: string | null; href: string }) {
  const tone = cardTone(card.name);
  const last4 = card.mask?.trim().slice(-4);
  const word = WORD[tone];
  return (
    <a className="card-face-link" href={href} tabIndex={-1} aria-hidden="true" onPointerMove={lean} onPointerLeave={level}>
      <div className={`card-face card-face-${tone}`}>
        <div className="card-face-top">{logo ? <BankLogo src={logo} name={card.bank ?? ""} size="sm" /> : card.bank && <span className="card-face-bank">{card.bank}</span>}</div>
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
