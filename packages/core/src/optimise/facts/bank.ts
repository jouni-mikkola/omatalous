/**
 * Facts of the bank area: Nordea's monthly prices for everyday services, read on 11.10.2026 from the price list page
 * ("Päivittäispalveluiden hinnat 1.5.2026 alkaen"). Package prices are not on that page, so a package fee stays
 * unmatched. Money in cents. The list ages as one: every row has the list's date as `asOf`.
 */
import type { Fact } from "./index.ts";

const SOURCE = { title: "Nordea: Hinnasto henkilöasiakkaiden tuotteille ja palveluille", url: "https://www.nordea.fi/henkiloasiakkaat/hinnat/hinnat.html" };

/** Id suffix, label, cents a month, as the page gives them. */
const PRICES: readonly [string, string, string, number][] = [
  ["account", "Käyttötili", "Current account", 260],
  ["banking_ids", "Pankkitunnukset", "Online banking codes", 99],
  ["debit", "Nordea Debit -kortti", "Nordea Debit card", 299],
  ["credit", "Nordea Credit -kortti", "Nordea Credit card", 299],
  ["gold", "Nordea Gold -kortti", "Nordea Gold card", 599],
  ["platinum", "Nordea Platinum -kortti", "Nordea Platinum card", 1699],
];

export const BANK_FACTS: readonly Fact[] = PRICES.map(([id, label, labelEn, cents]) => ({
  id: `nordea_price:${id}`,
  label,
  labelEn,
  value: cents,
  unit: "snt",
  kind: "price_list",
  status: "valid",
  validFrom: "2026-05-01",
  asOf: "2026-05-01",
  expires: "2027-05-01",
  source: SOURCE,
  verifiedAt: "2026-10-11",
}));
