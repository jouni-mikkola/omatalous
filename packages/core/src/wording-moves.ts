/**
 * Bank wording for money that is not spending or pay: a refund from the tax office, a move between the household's own
 * accounts and a cash withdrawal the bank types as a card payment. Folded upper case, as wording.ts.
 */
import { alternation } from "./wordlists.ts";

/** Money in from the tax office: a refund of tax paid too much, a category of its own and no benefit. */
export const TAX_REFUND_WORDS = alternation("TAX_REFUND_WORDS");

/**
 * The bank's own words for a move between the household's accounts that the bank gives no account number for ("Siirto
 * tililtä", "Siirto omalle tilille"): neither income nor saving. A savings account named in the text is saving
 * (isSavingsAccountText), and a card's "luoton siirto omalle tilille" is a credit drawn (CARD_ISSUER_WORDS).
 */
export const OWN_ACCOUNT_TRANSFER_WORDS = alternation("OWN_ACCOUNT_TRANSFER_WORDS");

/** A cash withdrawal the bank types as a card payment ("Korttimaksu/Nosto"): cash, ahead of the card payment fee words. */
export const CARD_CASH_WORDS = alternation("CARD_CASH_WORDS");
