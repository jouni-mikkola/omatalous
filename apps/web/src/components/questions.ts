import type { FiledWithoutAsking, PayerRole } from "@banking/core";
import { money, plural } from "../format.ts";

/** The whole percent of the money that is classified, rounded down: 99,6 % is "99 %", never "100 %". */
export function classifiedPercent(share: number): number {
  // 0.29 * 100 is 28.999999999999996: the sum of cents decides, not the float's last digits
  return Math.floor(share * 100 + 1e-9);
}

/** The smallest share the page names as a number; a share above 0 under it is "alle" it. */
const SMALLEST_PERCENT = 1;

/** A share as the page says it: whole percent rounded down, "alle 1 %" for a share above 0 that rounds to nothing. */
export function percentText(share: number): string {
  const percent = classifiedPercent(share);
  return share > 0 && percent < SMALLEST_PERCENT ? `alle ${SMALLEST_PERCENT} %` : `${percent} %`;
}

/** The lines of Tietojen laatu about the spending filed without asking: none when nothing was spent; the sentences on the guess and on the user's answers only when above zero. */
export function filedLines(filed: FiledWithoutAsking | null): string[] {
  if (!filed) return [];
  return [
    `Viimeisen 12 kuukauden menoista ${percentText(filed.share)} on luokiteltu ilman kysymistä.`,
    ...(filed.guessShare > 0 ? [`Näistä arvioita ${percentText(filed.guessShare)}.`] : []),
    ...(filed.userShare > 0 ? [`Itse luokittelit ${percentText(filed.userShare)}.`] : []),
  ];
}

/** The block is drawn when the share is told and there is something to ask or the picture is under 95 % mended. */
export function asks(questions: { share: number | null; items: readonly unknown[] }): boolean {
  return questions.share !== null && (questions.items.length > 0 || questions.share < 0.95);
}

/** What money from a payer can be, in the page's words (core `PAYER_ROLES` in page order). */
export const PAYER_ROLE_LABEL: Record<PayerRole, string> = {
  cost_share: "Yhteisten menojen osuus",
  sales: "Myynti",
  own_money: "Omaa rahaa",
  gift: "Lahja",
  pay: "Palkka tai etuus",
};

/** The same roles for MobilePay money that names no sender: shares of shared purchases, sales, other income. */
export const WALLET_ROLE_LABEL: Partial<Record<PayerRole, string>> = {
  cost_share: "Osuuksia yhteisistä ostoista",
  sales: "Myyntituloja",
  gift: "Muuta tuloa",
};

/** The question about MobilePay money that names no sender. */
export const walletQuestion = (count: number, cents: number): string => `Saapuneet MobilePay-maksut, ${plural(count, "maksu", "maksua")}, yhteensä ${money(cents)}. Mitä ne ovat?`;

/** The question about the payments of a service with no shop found behind it; a name of two words takes the ending as its own word ("Svea Payments -maksut"). */
export const serviceQuestion = (service: string, count: number, cents: number): string => {
  const ending = service.includes(" ") ? " -maksut" : "-maksut";
  return `${service}${ending}, ${plural(count, "maksu", "maksua")}, yhteensä ${money(cents)}. Mihin ne menivät?`;
};
