/**
 * The payment services that stand between the household and the shop or the friend: one list, read by the merchant
 * name (merchant.ts takes the shop out of the text behind the service), by the lexicon (lexicon-data.ts, as rows of the
 * kind `intermediary`) and by the panel that says "paid through". A name is folded text; a space in it is one or more spaces.
 */
interface PaymentService {
  /** The name as the page prints it. */
  name: string;
  /** What the text calls it: in front of the shop's name, or alone as the payee. */
  names: readonly string[];
  /** Short codes a card row writes in front of the shop's name, only before a star ("PP*", "IZ *"). */
  codes?: readonly string[];
  /** The row names only the service ("TRUSTLY GROUP AB") and its text holds the shop as a word beside a reference. */
  textMerchant?: true;
  /** A row that names only the service is the service's own payee under `name`; false: the old merchant name stays. */
  alone?: false;
}

/** The service a merchant name stands for when the row names only the service, else null. */
export const serviceNamed = (merchant: string): string | null => PAYMENT_SERVICES.find((s) => s.alone !== false && s.name === merchant)?.name ?? null;

export const PAYMENT_SERVICES: readonly PaymentService[] = [
  { name: "PayPal", names: ["PAYPAL"], codes: ["PP"] },
  { name: "Klarna", names: ["KLARNA"] },
  { name: "Paytrail", names: ["PAYTRAIL"], codes: ["PTL"] },
  { name: "SumUp", names: ["SUMUP"] },
  { name: "Zettle", names: ["ZETTLE"], codes: ["IZ"] },
  { name: "Square", names: ["SQUARE", "SQ"] },
  { name: "Stripe", names: ["STRIPE"] },
  { name: "Mollie", names: ["MOLLIE"] },
  { name: "Nets", names: ["NETS"] },
  { name: "Trustly", names: ["TRUSTLY"], textMerchant: true },
  { name: "Zimpler", names: ["ZIMPLER"], textMerchant: true },
  { name: "Brite", names: ["BRITE"], textMerchant: true },
  { name: "Adyen", names: ["ADYEN"] },
  { name: "Vipps", names: ["VIPPS MOBILEPAY", "VIPPS"] },
  { name: "MobilePay", names: ["MOBILEPAY"], alone: false },
  { name: "Checkout Finland", names: ["CHECKOUT FINLAND"], codes: ["CHECKOUT"], alone: false },
  { name: "Svea Payments", names: ["SVEA PAYMENTS"], alone: false },
];
