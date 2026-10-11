/** The parts of the Enable Banking API (https://enablebanking.com/docs/api/reference/) this app reads. */

export interface EbAmount {
  currency: string;
  amount: string;
}

export interface EbAccount {
  uid: string;
  /** Stable across sessions, unlike `uid`. Used to recognise an account after a new consent. */
  identification_hash?: string | null;
  account_id?: { iban?: string | null; other?: { identification?: string; scheme_name?: string } | null } | null;
  /** Every identifier the bank gives; a card's masked number (scheme CPAN) may be here instead of in `account_id`. */
  all_account_ids?: { identification?: string | null; scheme_name?: string | null }[] | null;
  /** The account holder or holders ("A;B"), not a name for the account. */
  name?: string | null;
  /** A description set by the user or the bank. */
  details?: string | null;
  /** The bank's product name (Käyttötili, ASP-tili, Nordea Gold). */
  product?: string | null;
  /** ISO 20022: CACC, CARD, CASH, LOAN, OTHR or SVGS. */
  cash_account_type?: string | null;
  currency?: string | null;
  /** The credit or overdraft the account may use. */
  credit_limit?: EbAmount | null;
}

export interface EbSession {
  session_id: string;
  accounts: (EbAccount | string)[];
  aspsp: { name: string; country: string };
  access: { valid_until: string };
}

export interface EbTransaction {
  entry_reference?: string | null;
  transaction_id?: string | null;
  merchant_category_code?: string | null;
  transaction_amount: EbAmount;
  creditor?: { name?: string | null } | null;
  creditor_account?: { iban?: string | null } | null;
  debtor?: { name?: string | null } | null;
  debtor_account?: { iban?: string | null } | null;
  bank_transaction_code?: { description?: string | null } | null;
  credit_debit_indicator: "CRDT" | "DBIT";
  status: "BOOK" | "PDNG" | "CNCL" | "HOLD" | "OTHR" | "RJCT" | "SCHD";
  booking_date?: string | null;
  value_date?: string | null;
  transaction_date?: string | null;
  reference_number?: string | null;
  remittance_information?: string[] | null;
  note?: string | null;
}

export interface EbTransactionsPage {
  transactions: EbTransaction[];
  continuation_key?: string | null;
}

export interface EbBalance {
  name?: string;
  balance_amount: EbAmount;
  balance_type: string;
  reference_date?: string | null;
}

/** GET /application: the application the signing key belongs to. `active` is false until accounts are linked in the Control Panel. */
export interface EbApplication {
  active?: boolean;
}

export interface EbAspsp {
  name: string;
  country: string;
  maximum_consent_validity?: number;
  psu_types?: string[];
}
