/**
 * Logos of the banks the server offers (apps/server/src/services/banks.ts).
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
