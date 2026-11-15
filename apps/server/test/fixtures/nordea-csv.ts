import type { RawTransaction } from "@banking/core";

/**
 * Test fixture: reads the semicolon separated files the tests hold, modelled on Nordea's netbank export, into rows
 * (csv-import-service.ts). The app's own parser is gone with the import. This one knows only the columns, the
 * dates (2026/09/30 or 2026-09-30) and the amounts ("-1 234,56") those files use, and throws on anything else, so a
 * row cannot be dropped without the test noticing. Nothing under src/ reads it.
 */

const COLUMNS = {
  date: ["Kirjauspäivä"],
  amount: ["Määrä"],
  name: ["Nimi", "Saaja/Maksaja"],
  title: ["Otsikko"],
  message: ["Viesti"],
  reference: ["Viitenumero"],
  currency: ["Valuutta"],
  payer: ["Maksaja"],
  payee: ["Maksunsaaja"],
} as const;

const looksLikeIban = (s: string | undefined) => !!s && /^[A-Z]{2}\d{2}[A-Z0-9 ]{8,}$/.test(s);
const compactIban = (s: string) => s.replace(/\s+/g, "");

function cents(text: string): number {
  const t = text.replace(/\s/g, "").replace(",", ".");
  if (!/^-?\d+(\.\d+)?$/.test(t)) throw new Error(`seed file: not an amount: ${text}`);
  return Math.round(Number(t) * 100);
}

function isoDate(text: string): string {
  const m = /^(\d{4})[/-](\d{2})[/-](\d{2})$/.exec(text);
  if (!m) throw new Error(`seed file: not a date: ${text}`);
  return `${m[1]}-${m[2]}-${m[3]}`;
}

export interface SeedFile {
  transactions: RawTransaction[];
  /** The exported account's own IBAN: the most common payer on money out and payee on money in. */
  ownIban: string | null;
}

export function parseSeedCsv(text: string): SeedFile {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  const header = (lines.shift() ?? "").split(";").map((h) => h.trim());
  const at = (key: keyof typeof COLUMNS) => header.findIndex((h) => (COLUMNS[key] as readonly string[]).includes(h));
  if (at("date") < 0 || at("amount") < 0) throw new Error(`seed file: no date or amount column: ${header.join(";")}`);
  const ownIbans = new Map<string, number>();
  const transactions = lines.map((line): RawTransaction => {
    const cells = line.split(";");
    const get = (key: keyof typeof COLUMNS) => cells[at(key)]?.trim() || undefined;
    const amountCents = cents(get("amount") ?? "");
    const currency = (get("currency") ?? "EUR").toUpperCase();
    if (currency !== "EUR") throw new Error(`seed file: not euros: ${currency}`);
    const counterpartyAccount = amountCents < 0 ? get("payee") : get("payer");
    const ownAccount = amountCents < 0 ? get("payer") : get("payee");
    if (looksLikeIban(ownAccount)) ownIbans.set(compactIban(ownAccount!), (ownIbans.get(compactIban(ownAccount!)) ?? 0) + 1);
    const description = [get("title"), get("message")].filter(Boolean).join(" ");
    return {
      externalId: null,
      bookingDate: isoDate(get("date") ?? ""),
      valueDate: null,
      amountCents,
      currency,
      status: "booked",
      counterparty: get("name") ?? null,
      counterpartyIban: looksLikeIban(counterpartyAccount) ? compactIban(counterpartyAccount!) : null,
      description: description || null,
      reference: get("reference") ?? null,
      mcc: null,
    };
  });
  // first seen wins a tie (Map keeps insertion order)
  let ownIban: string | null = null;
  for (const [iban, n] of ownIbans) if (ownIban === null || n > ownIbans.get(ownIban)!) ownIban = iban;
  return { transactions, ownIban };
}
