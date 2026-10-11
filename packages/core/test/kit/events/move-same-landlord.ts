/**
 * The household moves in June to a bigger flat of the same landlord: a new contract at 1 290 € instead of 1 050 € and
 * a rented van. SATO carries the deposit over to the new contract, so no deposit row shows (a deposit paid beside the
 * rent hid the false price rise in the first version of this event). 0.8.0 review (Optimoi housing): one step of
 * over 10 % at the same landlord is a move, never a rent rise to compare with the index ("leaves out one step over
 * 10 %" in optimise/home.test.ts).
 */
import { type LifeEvent, rows } from "../frame.ts";

export const moveSameLandlord: LifeEvent = {
  id: "move-same-landlord",
  add: (f) => {
    const { out, add } = rows("move-same-landlord", f.today);
    const moved = f.ago(4);
    add({ date: f.on(moved, 1), cents: -14_900, description: "BUDGET RENT A CAR HELSINKI", mcc: "7512", account: "card" });
    for (const m of f.months.filter((x) => x >= moved)) add({ date: f.on(m, 2), cents: -129_000, counterparty: "SATO OYJ", description: "VUOKRA 5120" });
    return out;
  },
  drop: (t, f) => t.description === "VUOKRA 4471" && t.bookingDate >= f.on(f.ago(4), 1),
  allows: [
    // October's rent is 240 € more than a year ago, told as an amount without a cause
    /^change change:season:/,
  ],
};
