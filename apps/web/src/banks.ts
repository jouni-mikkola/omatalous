/**
 * Logos of the banks the server offers (apps/server/src/connectors/enable-banking/banks.ts).
 * Official artwork from the bank's brand pages, in public/banks/, shown on a
 * white plate so the brand colours stay as intended in dark mode too.
 */
const LOGOS: Record<string, string> = {
  "nordea-fi": "/banks/nordea.png",
};

export function bankLogo(id: string): string | null {
  return LOGOS[id] ?? null;
}

/** Connections only know the institution name the bank reported. */
export function logoForInstitution(name: string): string | null {
  return /nordea/i.test(name) ? LOGOS["nordea-fi"]! : null;
}

/**
 * The bank of a consent. A consent keeps the name the bank reported ("Nordea"), the list the server offers has ids,
 * so a reconnect finds its bank by name. Null when no offered bank has that name, and the caller opens the picker.
 */
export function bankIdForInstitution(banks: readonly { id: string; name: string }[], institution: string): string | null {
  const name = institution.trim().toLowerCase();
  if (!name) return null;
  const hit = banks.find((b) => b.name.toLowerCase() === name) ?? banks.find((b) => name.includes(b.name.toLowerCase()));
  return hit?.id ?? null;
}
