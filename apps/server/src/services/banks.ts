/**
 * Banks the app offers to connect. Only these can be started from the UI:
 * the request names an id from this list, never a free-form bank name.
 * Adding a bank later = one entry here + its logo in apps/web/src/banks.ts.
 */
export interface BankOption {
  id: string;
  /** Shown in the UI. */
  name: string;
  /** ISO country code and the ASPSP name exactly as Enable Banking lists it. */
  country: string;
  aspspName: string;
  psuType: "personal" | "business";
}

export const BANKS: readonly BankOption[] = [{ id: "nordea-fi", name: "Nordea", country: "FI", aspspName: "Nordea", psuType: "personal" }];

export const DEFAULT_BANK = BANKS[0]!;

export function bankById(id: unknown): BankOption | undefined {
  return typeof id === "string" ? BANKS.find((b) => b.id === id) : undefined;
}
