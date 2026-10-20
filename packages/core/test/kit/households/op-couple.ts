/**
 * A couple on OP with a credit card paid by monthly statement: the card's charges of a month come as one statement row
 * on checking and one payment row on the card, both on the 9th of the next month. OP words: KORTTIOSTO, a reference in
 * the text, SUORAVELOITUS for the direct debits, pay as PALKKA with the employer's name. Two pays, a rent, groceries
 * and meals on the card, and a monthly move to a savings account.
 */
import { rows } from "../frame.ts";
import type { Account } from "../../../src/types.ts";
import { balanceOf, bankHousehold, payDay, setupOf, withBankFields } from "./build.ts";

const ACCOUNTS: Account[] = [
  { id: "chk", name: "OP Käyttötili", iban: "FI5750000120001234", currency: "EUR", type: "checking" },
  { id: "sav", name: "OP Säästötili", iban: "FI1250000120005678", currency: "EUR", type: "savings" },
  { id: "card", name: "OP Visa Credit", iban: null, currency: "EUR", type: "credit_card" },
];

const SHOPS: readonly { lambda: number; cents: number; texts: readonly string[]; mcc: string }[] = [
  { lambda: 14, cents: 4300, texts: ["S-MARKET HAUKIPUDAS", "K-SUPERMARKET OULU", "LIDL OULU KAAKKURI"], mcc: "5411" },
  { lambda: 3, cents: 3600, texts: ["RAVINTOLA TERRA OULU", "HESBURGER OULU"], mcc: "5812" },
  { lambda: 2, cents: 5900, texts: ["NESTE OULU", "ABC LAKEUS OULU"], mcc: "5542" },
  { lambda: 1, cents: 2200, texts: ["OULUN YLIOPISTON APTEEKKI"], mcc: "5912" },
  { lambda: 1, cents: 4800, texts: ["PROSHOP OULU", "TOKMANNI OULU"], mcc: "5311" },
];

export function opCouple() {
  const { f, n } = setupOf();
  const { out, add } = rows("op", f.today);
  for (const m of f.months) {
    add({ date: payDay(f, m, 15), cents: 281_000, counterparty: "OULUN KAUPUNKI", description: "PALKKA" });
    add({ date: payDay(f, m, 28), cents: 246_000, counterparty: "PROFILE SOFTWARE OY", description: "PALKKA" });
    add({ date: f.on(m, 1), cents: -88_500, counterparty: "KIINTEISTÖ OY OULUN KOIVIKKO", description: "VUOKRA" });
    add({ date: f.on(m, 7), cents: -4_290, counterparty: "OULUN ENERGIA OY", description: "SUORAVELOITUS SÄHKÖ" });
    add({ date: f.on(m, 11), cents: -2_190, counterparty: "DNA OYJ", description: "SUORAVELOITUS LIITTYMÄ" });
    add({ date: f.on(m, 20), cents: -3_000, counterparty: "RAHA", description: "OMA SIIRTO", iban: ACCOUNTS[1]!.iban });
    add({ date: f.on(m, 20), cents: 3_000, counterparty: "RAHA", description: "OMA SIIRTO", iban: ACCOUNTS[0]!.iban, account: "sav" });
    add({ date: f.on(m, 12), cents: -1_199, description: "SPOTIFY STOCKHOLM SE", account: "card" });
    for (const s of SHOPS) {
      for (let v = n.visits(s.lambda); v > 0; v--) {
        add({ date: f.on(m, 1 + Math.floor(n.next() * 28)), cents: -n.ticket(s.cents), description: `KORTTIOSTO ${s.texts[Math.floor(n.next() * s.texts.length)]!}`, mcc: s.mcc, account: "card" });
      }
    }
  }
  // each month's charges are paid in full with the statement on the 9th of the next
  const charged = new Map<string, number>();
  for (const t of out) if (t.accountId === "card" && t.amountCents < 0) charged.set(t.bookingDate.slice(0, 7), (charged.get(t.bookingDate.slice(0, 7)) ?? 0) - t.amountCents);
  const bills = rows("op-bill", f.today);
  for (const [i, m] of f.months.entries()) {
    const bill = i > 0 ? charged.get(f.months[i - 1]!) : undefined;
    if (!bill) continue;
    bills.add({ date: f.on(m, 9), cents: -bill, counterparty: "OP KORTTI OY", description: "OP VISA CREDIT LASKU" });
    bills.add({ date: f.on(m, 9), cents: bill, counterparty: "OP KORTTI OY", description: "MAKSU", account: "card" });
  }
  // OP gives the rent's reference in its own field and codes card purchases and pay
  const txs = withBankFields([...out, ...bills.out], [
    { match: /^VUOKRA$/, code: "PMNT-ICDT-ESCT", reference: "20044" },
    { match: /^KORTTIOSTO/, code: "PMNT-CCRD-POSD" },
    { match: /^PALKKA$/, code: "PMNT-RCDT-SALA" },
  ]);
  const sum = (id: string) => txs.filter((t) => t.accountId === id).reduce((s, t) => s + t.amountCents, 0);
  const [chk, sav, card] = ACCOUNTS as [Account, Account, Account];
  return bankHousehold("bank:op-couple", ACCOUNTS, [balanceOf(chk, 310_000), balanceOf(sav, 600_000 + sum("sav")), balanceOf(card, sum("card"), { creditLimitCents: 300_000 })], txs);
}
