/**
 * Logos and names of the banks the server can connect (apps/server/src/connectors/enable-banking/banks.ts).
 * A logo is shown on a white plate, so the brand colours stay as intended in dark mode too. It is official artwork
 * bundled in public/banks/, or the picture the server serves from the app's own address: Enable Banking's logo of the
 * bank, fetched by the server, so the browser calls no third party. A bank with neither has its name on the plate.
 */
import type { BankOption } from "./types.ts";

const LOGOS: Record<string, string> = {
  "nordea-fi": "/banks/nordea.png",
};

/**
 * Where a bank's logo is, for every place that shows a bank: bundled artwork first, then the logo the server serves
 * (the bank option's `logo`), else null.
 */
export function bankLogo(id: string, isServed = false): string | null {
  return LOGOS[id] ?? (isServed ? `/api/bank/logos/${encodeURIComponent(id)}` : null);
}

/**
 * The names a consent may carry for each bank id of the server's list: a consent keeps the name Enable Banking
 * reported, which is not always the name shown in the app. One entry per bank of the server's list; the server sends
 * no aliases and only the banks its live list has, so these stay here, and bank-connections.test.ts fails for a bank
 * of the server's file that has no entry.
 */
const NAMES: Record<string, readonly string[]> = {
  "nordea-fi": ["Nordea"],
  "op-fi": ["OP"],
  "danske-fi": ["Danske Bank", "Danske"],
  "s-pankki-fi": ["S-Pankki"],
  "saastopankki-fi": ["Säästöpankki"],
  "omasp-fi": ["Oma Säästöpankki", "OmaSp"],
  "pop-fi": ["POP Pankki", "POP"],
  "aktia-fi": ["Aktia"],
  "alandsbanken-fi": ["Ålandsbanken"],
  "bank-norwegian-fi": ["Bank Norwegian"],
  "resurs-fi": ["Resurs Bank", "Resurs"],
  "morrow-fi": ["Morrow Bank", "Komplett Bank", "Komplett"],
  "eurocard-fi": ["Eurocard"],
  "finnair-plus-fi": ["Finnair Plus"],
  "sas-eurobonus-fi": ["SAS EuroBonus"],
  "holvi-fi": ["Holvi"],
  "revolut-fi": ["Revolut"],
};

const KNOWN = Object.entries(NAMES).map(([id, names]) => ({ id, name: names[0]! }));

/** A name as its words, without case or accents: "S-Pankki" is s and pankki, "Ålandsbanken Abp" alandsbanken and abp. */
function wordsOf(name: string): string[] {
  return name
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

/** True when `part` is a run of whole words of `words`: OP is not found inside POP Pankki. */
function hasRun(words: readonly string[], part: readonly string[]): boolean {
  for (let i = 0; i + part.length <= words.length; i++) {
    if (part.every((w, j) => words[i + j] === w)) return true;
  }
  return false;
}

/**
 * The bank of a consent. A consent keeps the name the bank reported ("Nordea"), the list the server offers has ids,
 * so a reconnect finds its bank by name. The longest name found wins among every known bank, offered or not, so an
 * Oma Säästöpankki consent is never taken for Säästöpankki. Null when the bank is not offered, and the caller opens
 * the picker.
 */
export function bankIdForInstitution(banks: readonly { id: string; name: string }[], institution: string): string | null {
  const words = wordsOf(institution);
  let best: { id: string; size: number } | null = null;
  const consider = (id: string, name: string) => {
    const part = wordsOf(name);
    const size = part.join("").length;
    if (part.length && hasRun(words, part) && size > (best?.size ?? 0)) best = { id, size };
  };
  for (const [id, names] of Object.entries(NAMES)) for (const name of names) consider(id, name);
  for (const bank of banks) consider(bank.id, bank.name);
  const id = (best as { id: string } | null)?.id;
  return id && banks.some((b) => b.id === id) ? id : null;
}

/** Connections only know the institution name the bank reported; `offered` is the server's list (Meta.bank.banks). Null for a bank without a logo. */
export function logoForInstitution(name: string, offered: readonly Pick<BankOption, "id" | "logo">[]): string | null {
  const id = bankIdForInstitution(KNOWN, name);
  return id ? bankLogo(id, offered.some((b) => b.id === id && b.logo === true)) : null;
}
