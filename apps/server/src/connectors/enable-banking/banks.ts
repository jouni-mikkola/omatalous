/**
 * Banks the app can connect. Only these can be started from the UI: the request names an id from this list, never
 * a free-form bank name. An id is stored and never renamed.
 *
 * Enable Banking's names could not be checked against its API when the list was written (the bank list needs an
 * application key), so the app checks them itself: `offeredFrom` keeps the entries the application's own live list
 * has and takes each name from there (app-setup.ts `offeredBanks`).
 *
 * Adding a bank = one entry here + its names in apps/web/src/banks.ts. Its logo comes from Enable Banking's list
 * (logos.ts); artwork bundled in the web app wins over it.
 */
import { logoAddress } from "./logos.ts";
import type { EbAspsp } from "./types.ts";

export interface BankOption {
  id: string;
  /** Shown in the UI. */
  name: string;
  /** ISO country code. */
  country: string;
  /** The ASPSP name as Enable Banking lists it. An offered entry has the live list's own spelling. */
  aspspName: string;
  /** Other names the plan or Enable Banking's pages use for the bank, tried when the first is not on the live list. */
  aspspAliases?: readonly string[];
  psuType: "personal" | "business";
  /**
   * Hosts the bank's own public sign-in pages are on, each with its subdomains. The consent page may be on these
   * (client.ts `AUTH_HOSTS`). Only a host of the bank's own, seen on its sign-in page. An empty list means none could
   * be confirmed: a consent page on that bank's own host is then refused, and the admin can allow it with EB_AUTH_HOSTS.
   */
  authHosts: readonly string[];
  /** Set on an offered entry whose logo the server serves: the live list gave an address it may fetch (logos.ts). */
  logo?: true;
}

const fi = (id: string, name: string, authHosts: readonly string[], aspspAliases?: readonly string[]): BankOption => ({
  id,
  name,
  country: "FI",
  aspspName: name,
  ...(aspspAliases ? { aspspAliases } : {}),
  psuType: "personal",
  authHosts,
});

/** Finnish banks Enable Banking covers (enablebanking.com/open-banking-apis, read 2026-10-12). Nordea stays first: it is the default. */
export const BANKS: readonly BankOption[] = [
  fi("nordea-fi", "Nordea", ["nordea.com", "nordea.fi"]),
  fi("op-fi", "OP", ["op.fi"]),
  // danskebank.com: the PSD2 hosts of Danske's developer pages (psd2-api, psd2-mb3)
  fi("danske-fi", "Danske Bank", ["danskebank.fi", "danskebank.com"], ["Danske"]),
  fi("s-pankki-fi", "S-Pankki", ["s-pankki.fi"]),
  fi("saastopankki-fi", "Säästöpankki", ["saastopankki.fi"]),
  fi("omasp-fi", "Oma Säästöpankki", ["omasp.fi"], ["OmaSp"]),
  fi("pop-fi", "POP Pankki", ["poppankki.fi"], ["POP"]),
  fi("aktia-fi", "Aktia", ["aktia.fi"]),
  fi("alandsbanken-fi", "Ålandsbanken", ["alandsbanken.fi"]),
  fi("bank-norwegian-fi", "Bank Norwegian", ["banknorwegian.fi"]),
  fi("resurs-fi", "Resurs Bank", ["resursbank.fi"], ["Resurs"]),
  // Komplett Bank until 2023
  fi("morrow-fi", "Morrow Bank", ["morrowbank.fi"], ["Komplett Bank", "Komplett"]),
  // SEB Kort Bank's cards. Eurocard's sign-in page sends card holders to my.spendwise.fi.
  fi("eurocard-fi", "Eurocard", ["eurocard.com", "my.spendwise.fi"]),
  // no host: the two cards' own sites and Revolut's sign-in page could not be read when the list was written
  fi("finnair-plus-fi", "Finnair Plus Mastercard", [], ["Finnair Plus MC"]),
  fi("sas-eurobonus-fi", "SAS EuroBonus Mastercard", [], ["SAS EuroBonus MC"]),
  fi("holvi-fi", "Holvi", ["holvi.com"]),
  fi("revolut-fi", "Revolut", []),
];

export const DEFAULT_BANK = BANKS[0]!;

export function bankById(id: unknown): BankOption | undefined {
  return typeof id === "string" ? BANKS.find((b) => b.id === id) : undefined;
}

/**
 * A name as it is compared: its letters and digits, without case or accents. Spacing, hyphens and case differ
 * between Enable Banking's pages and its API ("S-Pankki", "POP Pankki").
 */
function nameKey(name: unknown): string {
  return typeof name === "string" ? name.normalize("NFKD").replace(/[^\p{L}\p{N}]/gu, "").toLowerCase() : "";
}

const namesOf = (bank: BankOption): string[] => [bank.aspspName, ...(bank.aspspAliases ?? [])].map(nameKey);

/** The live list's entry for a bank, when it has one for the bank's kind of customer. */
export function findAspsp(bank: BankOption, aspsps: readonly EbAspsp[]): EbAspsp | undefined {
  for (const key of namesOf(bank)) {
    const hit = aspsps.find((a) => nameKey(a?.name) === key && (!Array.isArray(a.psu_types) || a.psu_types.includes(bank.psuType)));
    if (hit) return hit;
  }
  return undefined;
}

/**
 * The banks of the list that a live `GET /aspsps` answer has, each named as the answer writes it. `logo` says that
 * the answer has a logo address the server may fetch, not that the picture has been fetched.
 */
export function offeredFrom(aspsps: readonly EbAspsp[]): BankOption[] {
  return BANKS.flatMap((bank) => {
    const hit = findAspsp(bank, aspsps);
    if (!hit) return [];
    return [{ ...bank, aspspName: hit.name, ...(logoAddress(hit.logo) ? { logo: true as const } : {}) }];
  });
}

/** The id of the bank a consent names, for the log. Null for a name outside the list. */
export function bankIdForAspsp(name: unknown): string | null {
  const key = nameKey(name);
  return (key && BANKS.find((b) => namesOf(b).includes(key))?.id) || null;
}
