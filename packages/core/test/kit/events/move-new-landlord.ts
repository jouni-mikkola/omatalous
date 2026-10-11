/**
 * The household moves in June to a flat of another landlord: SATO's rent ends, Kojamo's 1 180 € starts the same
 * month, with a deposit to Kojamo and SATO's deposit back a month later. 0.8.0 review (insights and Optimoi): the old
 * rent is no stopped payment that frees money and the new one no new commitment; a new payee in the same category is a
 * switch ("stopped: a new provider in the same category is a switch" in insights.test.ts).
 */
import { type LifeEvent, rows } from "../frame.ts";

export const moveNewLandlord: LifeEvent = {
  id: "move-new-landlord",
  add: (f) => {
    const { out, add } = rows("move-new-landlord", f.today);
    const moved = f.ago(4);
    add({ date: f.on(moved, 1), cents: -236_000, counterparty: "KOJAMO OYJ", description: "VAKUUSMAKSU 88213" });
    add({ date: f.on(f.ago(3), 20), cents: 210_000, counterparty: "SATO OYJ", description: "VAKUUDEN PALAUTUS 4471" });
    for (const m of f.months.filter((x) => x >= moved)) add({ date: f.on(m, 1), cents: -118_000, counterparty: "KOJAMO OYJ", description: "LUMO VUOKRA 88213" });
    return out;
  },
  drop: (t, f) => t.description === "VUOKRA 4471" && t.bookingDate >= f.on(f.ago(4), 1),
  allows: [
    // Kojamo's rent is 130 € more than SATO's was a year ago
    /^change change:season:/,
    // the dearer rent since June and the deposit paid beside the one returned
    /^change change:year:/,
  ],
};
