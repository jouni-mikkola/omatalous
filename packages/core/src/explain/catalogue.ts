/**
 * The sentence of each rule, with the numbers of the reason in it. The words are in the message catalogue
 * (`messages-explain.ts`), so the string rules read them; this file picks the code and fills the holes. A sentence
 * made by the server (a method's rule) is Finnish, as the answer of the route is; `sentenceOf` takes the reader's language.
 */
import { formatEur, formatFiDate } from "../analysis/format.ts";
import { DEFAULT_LANGUAGE, type Language } from "../locale.ts";
import { type MessageCode, message, messageIn } from "../messages.ts";
import { MIN_COMPARE_MONTHS, PERIODIC_MONTHS, USUAL_MONTHS } from "../thresholds.ts";
import type { Reason, RuleId } from "./types.ts";

const SOURCES = {
  rule: "explain.source_rule",
  mcc: "explain.source_mcc",
  merchant: "explain.source_merchant",
  industry: "explain.source_industry",
  default: "explain.source_default",
} as const satisfies Record<string, MessageCode>;

/** Why a bank's balance is taken as it is, by the reason the reconcile gives. */
const UNPROVEN = {
  no_reference_day: "explain.unproven_no_reference_day",
  only_available: "explain.unproven_only_available",
  type_changed: "explain.unproven_type_changed",
  too_few: "explain.unproven_too_few",
} as const satisfies Record<string, MessageCode>;

const fraction = (r: Reason) => `${Number(r.to) - Number(r.from)}/${r.of}`;

const sourceOf = (source: string) => (Object.hasOwn(SOURCES, source) ? SOURCES[source as keyof typeof SOURCES] : SOURCES.default);
const unprovenOf = (reason: string) => (Object.hasOwn(UNPROVEN, reason) ? UNPROVEN[reason as keyof typeof UNPROVEN] : UNPROVEN.too_few);

/** The sentence of each rule in a language, with the numbers of the reason in it. */
const CATALOGUE: Record<RuleId, (r: Reason, lang: Language) => string> = {
  "category.hand": (_r, lang) => messageIn(lang, "explain.category_hand"),
  "category.own_rule": (_r, lang) => messageIn(lang, "explain.category_own_rule"),
  "category.builtin": (r, lang) => messageIn(lang, sourceOf(String(r.source))),
  "transfer.pair": (r, lang) => messageIn(lang, r.people ? "explain.transfer_people" : "explain.transfer_pair"),
  "transfer.channel": (_r, lang) => messageIn(lang, "explain.transfer_channel"),
  "card.bill": (_r, lang) => messageIn(lang, "explain.card_bill"),
  "card.unshown": (r, lang) => messageIn(lang, "explain.card_unshown", { sum: formatEur(Number(r.cents), true, lang) }),
  "card.payer_unseen": (_r, lang) => messageIn(lang, "explain.card_payer_unseen"),
  "card.payer_mixed": (r, lang) => messageIn(lang, "explain.card_payer_mixed", { pool: formatEur(Number(r.pool), true, lang), outside: formatEur(Number(r.outside), true, lang) }),
  "balance.unproven": (r, lang) => messageIn(lang, unprovenOf(String(r.reason))),
  "return.shop": (_r, lang) => messageIn(lang, "explain.return_shop"),
  "return.person": (_r, lang) => messageIn(lang, "explain.return_person"),
  "return.share": (_r, lang) => messageIn(lang, "explain.return_share"),
  // the page puts the purchase's shop in `shop`: a reason holds ids and days, no names
  "return.wallet": (r, lang) => {
    const date = formatFiDate(String(r.day), lang);
    return r.shop ? messageIn(lang, "explain.return_wallet_shop", { shop: String(r.shop), date }) : messageIn(lang, "explain.return_wallet", { date });
  },
  "share.back": (r, lang) => messageIn(lang, Number(r.count) === 1 ? "explain.share_back_one" : "explain.share_back_many", { sum: formatEur(Number(r.cents), true, lang), count: Number(r.count) }),
  "share.open": (_r, lang) => messageIn(lang, "explain.share_open"),
  "via.service": (r, lang) => messageIn(lang, "explain.via_service", { service: String(r.service) }),
  "refund.net": (r, lang) => {
    const months = Number(r.months);
    return months === 0 ? messageIn(lang, "explain.refund_same") : months === 1 ? messageIn(lang, "explain.refund_previous") : messageIn(lang, "explain.refund_months", { months });
  },
  "part.use": (r, lang) => messageIn(lang, "explain.part_use", { share: fraction(r) }),
  "part.source": (r, lang) => messageIn(lang, r.mine ? "explain.part_source_mine" : "explain.part_source_other"),
  "role.payer": (_r, lang) => messageIn(lang, "explain.role_payer"),
  "settle.paid": (_r, lang) => messageIn(lang, "explain.settle_paid"),
  "settle.owed": (_r, lang) => messageIn(lang, "explain.settle_owed"),
  "settle.refund": (_r, lang) => messageIn(lang, "explain.settle_refund"),
  "settle.credit_filled": (_r, lang) => messageIn(lang, "explain.settle_credit_filled"),
  "settle.unknown": (_r, lang) => messageIn(lang, "explain.settle_unknown"),
  "settle.open": (_r, lang) => messageIn(lang, "explain.settle_open"),
  "settle.closed": (_r, lang) => messageIn(lang, "explain.settle_closed"),
  "agree.dated": (r, lang) => messageIn(lang, "explain.agree_dated", { date: formatFiDate(String(r.valid_from), lang) }),
  "rounding.cent": (_r, lang) => messageIn(lang, "explain.rounding_cent"),
  "bill.spread": (r, lang) => messageIn(lang, "explain.bill_spread", { months: Number(r.months) }),
  "bill.usual": (_r, lang) => messageIn(lang, "explain.bill_usual"),
};

export const sentenceOf = (r: Reason, lang: Language = DEFAULT_LANGUAGE): string => CATALOGUE[r.rule](r, lang);

/** The months the expected month reads. */
export const expectedRule = (): string => message("explain.expected_rule", { months: USUAL_MONTHS });
/** How the listed months make the figure: a category at a time, not the months' totals. */
export const expectedHow = (): string => message("explain.expected_how", { months: PERIODIC_MONTHS });
/** The page's usual income: a median of the report's months, each the regular income of its pay period. */
export const incomeRule = (): string => message("explain.income_rule", { months: USUAL_MONTHS });
export const medianTie = (count: number): string => message(count % 2 ? "explain.median_odd" : "explain.median_even");
/**
 * The pay the window waits for, as the page says it: a steady pay by the median of its pays, one that varies by the range
 * from the quarter of the pays below to the quarter above; and the month of earlier years that moved it.
 */
export const payRule = (count: number, steady: boolean, season: boolean): string => {
  const how = steady ? message("explain.pay_steady", { count }) : message("explain.pay_varying", { count });
  return season ? `${how}. ${message("explain.pay_season")}` : how;
};
/** What a usual level says when the months are too few for one. */
export const tooFewMonths = (count: number, needed: number = MIN_COMPARE_MONTHS): string => message("explain.too_few_months", { needed, count });
