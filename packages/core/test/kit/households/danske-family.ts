/**
 * A family on Danske Bank: one member's checking account and a joint account of both holders, where the other member's
 * pay lands. No split of
 * the joint account is said anywhere (owner rule L5): it is counted whole and marked unknown. The day-care fee and the
 * mortgage instalment leave the joint account. Danske's Swedish words appear in the texts (KORTKÖP, LÖN, AVGIFT).
 */
import { rows } from "../frame.ts";
import type { Account } from "../../../src/types.ts";
import { balanceOf, bankHousehold, payDay, setupOf, withBankFields } from "./build.ts";

const ACCOUNTS: Account[] = [
  { id: "chk", name: "Danske Bank Lönekonto", iban: "FI7480001400123456", currency: "EUR", type: "checking" },
  { id: "joint", name: "Yhteistili", iban: "FI2180001400654321", currency: "EUR", type: "checking" },
  { id: "loan", name: "Asuntolaina", iban: "FI6480001400777777", currency: "EUR", type: "loan" },
];

const SHOPS: readonly { lambda: number; cents: number; texts: readonly string[]; mcc: string }[] = [
  { lambda: 16, cents: 5200, texts: ["K-MARKET ESPOO TAPIOLA", "S-MARKET ESPOO", "LIDL ESPOO"], mcc: "5411" },
  { lambda: 3, cents: 4100, texts: ["RAVINTOLA NOKKA ESPOO", "HESBURGER TAPIOLA"], mcc: "5812" },
  { lambda: 2, cents: 6400, texts: ["ST1 ESPOO", "NESTE ESPOO"], mcc: "5542" },
  { lambda: 1, cents: 2300, texts: ["TAPIOLAN APTEEKKI"], mcc: "5912" },
  { lambda: 1, cents: 5000, texts: ["LINDEX TAPIOLA", "JYSK ESPOO"], mcc: "5651" },
];

export function danskeFamily() {
  const { f, n } = setupOf(31);
  const { out, add } = rows("dk", f.today);
  for (const m of f.months) {
    add({ date: payDay(f, m, 25), cents: 389_000, counterparty: "NOVA SOFTWARE OY", description: "LÖN" });
    // the joint account is fed by a fixed move from checking; the transfer has both legs
    add({ date: f.on(m, 26), cents: -150_000, counterparty: "OMA SIIRTO", description: "ÖVERFÖRING YHTEISTILI", iban: ACCOUNTS[1]!.iban });
    add({ date: f.on(m, 26), cents: 150_000, counterparty: "OMA SIIRTO", description: "ÖVERFÖRING", iban: ACCOUNTS[0]!.iban, account: "joint" });
    add({ date: payDay(f, m, 20), cents: 312_000, counterparty: "ESPOON KAUPUNKI", description: "PALKKA", account: "joint" });
    add({ date: f.on(m, 3), cents: -98_700, counterparty: "DANSKE BANK OYJ", description: "LAINANLYHENNYS ASUNTOLAINA", iban: ACCOUNTS[2]!.iban, account: "joint" });
    // the city charges the fee eleven months a year
    if (!m.endsWith("-07")) add({ date: f.on(m, 8), cents: -28_500, counterparty: "ESPOON KAUPUNKI", description: "VARHAISKASVATUSMAKSU", account: "joint" });
    add({ date: f.on(m, 2), cents: -4_380, counterparty: "FORTUM MARKKINAT OY", description: "SUORAVELOITUS", account: "joint" });
    add({ date: f.on(m, 14), cents: -2_190, counterparty: "TELIA FINLAND OYJ", description: "E-FAKTURA", account: "joint" });
    add({ date: f.on(m, 28), cents: -490, counterparty: "DANSKE BANK OYJ", description: "AVGIFT KONTO", account: "chk" });
    for (const s of SHOPS) {
      for (let v = n.visits(s.lambda); v > 0; v--) {
        add({ date: f.on(m, 1 + Math.floor(n.next() * 28)), cents: -n.ticket(s.cents), description: `KORTKÖP ${s.texts[Math.floor(n.next() * s.texts.length)]!}`, mcc: n.next() < 0.5 ? s.mcc : null, account: "joint" });
      }
    }
  }
const txs = withBankFields(out, [
    { match: /^LÖN$|^PALKKA$/, code: "PMNT-RCDT-SALA" },
    { match: /^KORTKÖP/, code: "PMNT-CCRD-POSD" },
    { match: /^ÖVERFÖRING/, code: "PMNT-ICCN-COAT" },
    { match: /^VARHAISKASVATUSMAKSU$/, code: "PMNT-ICDT-ESCT", reference: "40018832" },
  ]);
  const sum = (id: string) => txs.filter((t) => t.accountId === id).reduce((s, t) => s + t.amountCents, 0);
  return bankHousehold("bank:danske-family", ACCOUNTS, [balanceOf(ACCOUNTS[0]!, 90_000 + sum("chk")), balanceOf(ACCOUNTS[1]!, 220_000 + sum("joint"), { joint: true }), balanceOf(ACCOUNTS[2]!, null)], txs);
}
