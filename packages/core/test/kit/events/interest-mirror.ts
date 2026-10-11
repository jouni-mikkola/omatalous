/**
 * The household moves 600 € to savings at the end of September; the checking leg names the savings account, the
 * savings leg two days later reads KORKO and names no account. 0.8.0 review (Optimoi savings): the savings leg of an
 * own move is no interest ("never takes the savings leg of a move for interest" in optimise/money.test.ts).
 */
import { IBAN, type LifeEvent, rows } from "../frame.ts";

export const interestMirror: LifeEvent = {
  id: "interest-mirror",
  add: (f) => {
    const { out, add } = rows("interest-mirror", f.today);
    add({ date: f.on(f.ago(1), 28), cents: -60_000, counterparty: "MATTI MEIKÄLÄINEN", description: "OMA SIIRTO", iban: IBAN.sav });
    add({ date: f.on(f.ago(1), 30), cents: 60_000, description: "KORKO", account: "sav" });
    return out;
  },
  allows: [],
};
