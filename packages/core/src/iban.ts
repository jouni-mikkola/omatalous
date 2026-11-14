/** An IBAN as one upper-case token without the spaces a bank groups it with, or null for none. */
export function normalizeIban(iban: string | null | undefined): string | null {
  const s = iban?.replace(/\s+/g, "").toUpperCase();
  return s ? s : null;
}
