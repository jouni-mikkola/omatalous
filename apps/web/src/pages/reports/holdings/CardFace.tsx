/**
 * Decision: which card of the household is which, at a glance. A flat row on Yhteenveto, as every other row of the page is:
 * the bank (its logo when the app has one, else its name), the card's name as the link to the card's rows, and its last
 * four digits, all as text in the page's own size and colours. No picture, gradient, shadow or chip (design section 3,
 * Avoid). The row is the card's name for the unit: the unit's head holds only the lines under it. The last four digits
 * also tell apart two cards that share a name. `card.name` is the name as it is shown (`cardName`).
 */
import type { DashboardData } from "../../../types.ts";
import { BankLogo } from "../../../components/BankLogo.tsx";

type Card = DashboardData["holdings"]["cards"][number];

/** `bank`: the bank the row shows (`cardBankOf`), with its logo when the app has one. `href`: the card's rows in Tapahtumat. */
export function CardFace({ card, bank, href }: { card: Pick<Card, "name" | "mask">; bank: { bank: string; src: string | null } | null; href: string }) {
  const last4 = card.mask?.trim().slice(-4);
  return (
    <div className="card-face">
      {bank?.src ? <BankLogo src={bank.src} name={bank.bank} size="sm" decorative /> : bank?.bank && <span className="card-face-bank">{bank.bank}</span>}
      <span className="st-name holding-name card-face-name" title={card.name}>
        <a href={href}>{card.name}</a>
      </span>
      {last4 && <span className="card-face-mask">{`•••• ${last4}`}</span>}
    </div>
  );
}
