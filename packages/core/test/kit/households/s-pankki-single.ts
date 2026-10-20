/**
 * A single person on S-Pankki: irregular pay (a freelancer's invoices of uneven sums on uneven days), a student loan
 * instalment, Siirto and MobilePay with friends, and debit card purchases of the S-Pankki card.
 */
import { rows } from "../frame.ts";
import type { Account } from "../../../src/types.ts";
import { balanceOf, bankHousehold, setupOf, withBankFields } from "./build.ts";

const ACCOUNTS: Account[] = [
  { id: "chk", name: "S-Pankki Käyttötili", iban: "FI4171230000246810", currency: "EUR", type: "checking" },
  { id: "loan", name: "Opintolaina", iban: "FI8071230000135790", currency: "EUR", type: "loan" },
];

const SHOPS: readonly { lambda: number; cents: number; texts: readonly string[]; mcc: string }[] = [
  { lambda: 12, cents: 2900, texts: ["PRISMA TAMPERE HERVANTA", "S-MARKET TAMPERE", "SALE HERVANTA"], mcc: "5411" },
  { lambda: 4, cents: 1500, texts: ["UNICAFE TAMPERE", "FAZER CAFE TAMPERE"], mcc: "5814" },
  { lambda: 2, cents: 2600, texts: ["WOLT TAMPERE FI", "RAVINTOLA PIZZERIA TAMPERE"], mcc: "5812" },
  { lambda: 1, cents: 1900, texts: ["TAMPEREEN APTEEKKI"], mcc: "5912" },
  { lambda: 1.5, cents: 4600, texts: ["ABC HERVANTA TAMPERE", "NESTE TAMPERE"], mcc: "5542" },
  { lambda: 1, cents: 3500, texts: ["INTERSPORT TAMPERE", "H&M TAMPERE"], mcc: "5651" },
];
const FRIENDS = ["AINO KORHONEN", "VESA LEHTONEN", "NOORA SALMI"] as const;

export function sPankkiSingle() {
  const { f, n } = setupOf(23);
  const { out, add } = rows("sp", f.today);
  for (const m of f.months) {
    // two or three invoices a month, paid on any day, by a few clients
    for (let i = 0, k = 2 + Math.floor(n.next() * 2); i < k; i++) {
      add({ date: f.on(m, 3 + Math.floor(n.next() * 25)), cents: Math.round(n.jitter(90_000, 0.5)), counterparty: ["MEDIATALO OY", "STUDIO NORTH OY", "KEMI DESIGN OY"][i % 3], description: `LASKU ${2000 + Math.floor(n.next() * 900)}` });
    }
    add({ date: f.on(m, 1), cents: -49_500, counterparty: "TOAS SÄÄTIÖ", description: "VUOKRA 8821" });
    add({ date: f.on(m, 5), cents: -9_800, counterparty: "S-PANKKI OY", description: "LAINANLYHENNYS OPINTOLAINA", iban: ACCOUNTS[1]!.iban });
    add({ date: f.on(m, 10), cents: -1_990, counterparty: "ELISA OYJ", description: "E-LASKU" });
    add({ date: f.on(m, 16), cents: -1_299, counterparty: "NETFLIX", description: "NETFLIX.COM" });
    for (const s of SHOPS) {
      for (let v = n.visits(s.lambda); v > 0; v--) {
        add({ date: f.on(m, 1 + Math.floor(n.next() * 28)), cents: -n.ticket(s.cents), description: `KORTTIOSTO ${s.texts[Math.floor(n.next() * s.texts.length)]!}`, mcc: s.mcc });
      }
    }
    // Siirto and MobilePay with friends: small sums both ways
    for (let v = n.visits(3); v > 0; v--) {
      const mobilepay = n.next() < 0.5;
      const out_ = n.next() < 0.6;
      add({ date: f.on(m, 1 + Math.floor(n.next() * 28)), cents: (out_ ? -1 : 1) * n.ticket(1800), counterparty: FRIENDS[Math.floor(n.next() * FRIENDS.length)], description: mobilepay ? "MOBILEPAY" : "SIIRTO-MAKSU" });
    }
  }
const txs = withBankFields(out, [
    { match: /^KORTTIOSTO/, code: "PMNT-CCRD-POSD" },
    { match: /^LASKU \d+$/, code: "PMNT-RCDT-ESCT", reference: "" },
    { match: /^(SIIRTO-MAKSU|MOBILEPAY)$/, code: "PMNT-RRCT-ESCT" },
  ]);
  return bankHousehold("bank:s-pankki-single", ACCOUNTS, [balanceOf(ACCOUNTS[0]!, 140_000), balanceOf(ACCOUNTS[1]!, null)], txs);
}
