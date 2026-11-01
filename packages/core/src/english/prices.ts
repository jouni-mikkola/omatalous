/** The English table of prices; the Finnish one it must match is in ../messages-prices.ts. */
import type { FI_PRICES } from "../messages-prices.ts";

export const EN_PRICES: Record<keyof typeof FI_PRICES, string> = {
  "prices.title": "Your prices against the consumer price index",
  "prices.question": "Did your fixed prices rise faster than prices in general?",
  "prices.off": "There is no comparison because the consumer price index series has not been fetched (the fetch is off, or the series has not arrived yet). An admin turns the fetch on under Settings > Server. The server then fetches the public series of Statistics Finland and sends nothing of your finances.",
  "prices.short": "The comparison is not possible: the fetched index series lacks months in {from} to {to}. The series is refreshed once a day.",
  "prices.no_basket": "The comparison is not possible: you have no fixed-price subscription that already charged in {month}.",
  "prices.answer_more": "Your fixed-price basket changed {own} from {from} to {to}, while the consumer price index changed {index}. Your series divided by the index is {gap} higher than at the start: your prices rose faster than prices in general.",
  "prices.answer_less": "Your fixed-price basket changed {own} from {from} to {to}, while the consumer price index changed {index}. Your series divided by the index is {gap} lower than at the start: your prices rose slower than prices in general.",
  "prices.answer_same": "Your fixed-price basket changed {own} from {from} to {to}, while the consumer price index changed {index}. The two changes are equal.",
  "prices.basis": "Your own series is a basket of fixed-price charges: each subscription's price in force at the time times its charges a month. Only subscriptions that already charged in {month} and still run are in it, and quantities stay the same, so only price moves the series. A price rise under 0.50 euros or under 3 percent is not seen, because the price changes of the fixed costs page are read with the same limit. The comparison series is the consumer price index, source {source}, table {table}, fetched {date}.",
  "prices.caption_months": "Your price series and the consumer price index by month",
  "prices.caption_services": "The subscriptions in the basket and their prices",
  "prices.col_month": "Month",
  "prices.col_own": "Your series",
  "prices.col_index": "Index",
  "prices.col_relative": "Your series divided by the index",
  "prices.col_service": "Subscription",
  "prices.col_from": "Price at the start",
  "prices.col_to": "Price now",
  "prices.col_change": "Change",
};
