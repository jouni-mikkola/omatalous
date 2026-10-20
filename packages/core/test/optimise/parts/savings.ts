/**
 * Savings rows: 2 000 € moved to savings on the 17th and deposit interest on the savings account each 31 December.
 * The hit keeps 30 000 € on checking and 50 000 € on savings, so the checking account never fell near a month of
 * spending and the savings paid about 1,2 % after tax.
 */
import { balanceWalk } from "../../../src/analysis/balance-walk.ts";
import { addDays, addMonths, dayNumber } from "../../../src/dates.ts";
import { areaInputOf } from "../../../src/optimise/index.ts";
import type { InputValues } from "../../../src/optimise/types.ts";
import { lowestDayBalance } from "../../../src/reports/balances.ts";
import { bufferReport } from "../../../src/reports/buffer.ts";
import type { Account, BalanceInput, Transaction } from "../../../src/types.ts";
import { type Frame, householdInput, joinHousehold, type Part, type PartHousehold } from "../household.ts";

const IBAN = { chk: "FI2112345600000785", sav: "FI1410093000123458", second: "FI7933000100000080" };
const SECOND: Account = { id: "s-chk2", name: "Toinen käyttötili", iban: IBAN.second, currency: "EUR", type: "checking" };

interface Rows {
  /** Interest paid on 31 December, cents. */
  interest: number;
  /** Weekly moves to a second checking account, none in three weeks of March in the window's last year. */
  second?: boolean;
}

function rows(frame: Frame, o: Rows): Transaction[] {
  const out: Transaction[] = [];
  const add = (p: Partial<Transaction> & Pick<Transaction, "bookingDate" | "amountCents" | "merchant">) => {
    if (p.bookingDate > frame.today) return;
    out.push({
      id: `s-${String(out.length).padStart(5, "0")}`,
      accountId: "h-chk",
      currency: "EUR",
      status: "booked",
      counterparty: null,
      counterpartyIban: null,
      description: null,
      mcc: null,
      category: "other",
      categorySource: "default",
      isTransfer: false,
      ...p,
    });
  };
  for (const month of [...frame.months, addMonths(frame.months[frame.months.length - 1]!, 1)]) {
    const on = (d: number) => `${month}-${String(d).padStart(2, "0")}`;
    add({ bookingDate: on(17), amountCents: -200000, merchant: "Siirto", description: "OMA SIIRTO", counterpartyIban: IBAN.sav });
    add({ bookingDate: on(17), amountCents: 200000, merchant: "Siirto", description: "OMA SIIRTO", accountId: "h-sav", counterpartyIban: IBAN.chk });
    if (month.endsWith("-12")) add({ bookingDate: on(31), amountCents: o.interest, merchant: "Talletuskorko", description: "TALLETUSKORKO", accountId: "h-sav" });
  }
  if (o.second) {
    const holeFrom = `${addMonths(frame.months[frame.months.length - 1]!, -6)}-02`;
    for (let day = frame.start; day <= frame.today; day = addDays(day, 6)) {
      if (day >= holeFrom && day < addDays(holeFrom, 21)) continue;
      add({ bookingDate: day, amountCents: -1000, merchant: "Siirto", description: "OMA SIIRTO", counterpartyIban: IBAN.second });
      add({ bookingDate: day, amountCents: 1000, merchant: "Siirto", description: "OMA SIIRTO", accountId: SECOND.id, counterpartyIban: IBAN.chk });
    }
  }
  return out;
}

const balance = (frame: Frame, id: string, name: string, type: Account["type"], cents: number, daysOld = 1): BalanceInput => ({
  id,
  name,
  type,
  balanceCents: cents,
  ownerName: null,
  balanceAt: addDays(frame.today, -daysOld),
});

function saver(frame: Frame, o: Rows & { chk?: number; daysOld?: number }): PartHousehold {
  return {
    txs: rows(frame, o),
    accounts: o.second ? [SECOND] : [],
    balances: [
      balance(frame, "h-chk", "Käyttötili", "checking", o.chk ?? 3000000, o.daysOld),
      balance(frame, "h-sav", "Säästötili", "savings", 5000000, o.daysOld),
      ...(o.second ? [balance(frame, SECOND.id, SECOND.name, "checking", 50000, o.daysOld)] : []),
    ],
  };
}

export const hit: Part["hit"] = (frame) => saver(frame, { interest: 45000 });

export const nearMiss: Part["nearMiss"] = (frame) => {
  // the lowest checking balance moves with the balance given: set it 1 900 € over a month of spending
  const probe = saver(frame, { interest: 45000 });
  const a = areaInputOf(householdInput(joinHousehold([probe], frame)));
  const chk = a.balances.find((b) => b.id === "h-chk")!;
  const low = lowestDayBalance([balanceWalk(a.ctx, chk)!], dayNumber(`${a.months[0]}-01`), a.ctx.todayDay)!;
  const usual = bufferReport(a.ctx, a.balances, a.inputs).usualSpendCents!;
  const idle1900 = saver(frame, { interest: 45000, chk: chk.balanceCents! - (low.cents - usual - 190000) });
  return [
    // 120 € on about 37 000 € is 0,3 %
    saver(frame, { interest: 12000 }),
    // the balances are ten days old
    saver(frame, { interest: 45000, daysOld: 10 }),
    // a second checking account with three weeks without a row
    saver(frame, { interest: 45000, second: true }),
    idle1900,
  ];
};

export const neutralValues: InputValues = {};
