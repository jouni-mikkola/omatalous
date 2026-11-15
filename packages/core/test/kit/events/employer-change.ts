/**
 * The employer changes in June: ACME OY's last pay is May's, the holiday pay of June is not paid, and TOINEN ESIMERKKI OY
 * pays 80 € more on the 25th from June on. The change is told once ("Palkanmaksaja vaihtui"), in the income report: the
 * kit's today is over 120 days after the old payer's last pay, so the first page no longer tells it. The old payer's
 * last pay is no missing salary, and the new level is no raise of the old payer.
 */
import { addDays } from "../../../src/dates.ts";
import { PAY_CENTS } from "../household.ts";
import { banking, type LifeEvent, rows } from "../frame.ts";

export const employerChange: LifeEvent = {
  id: "employer-change",
  add: (f) => {
    const { out, add } = rows("employer-change", f.today);
    for (const m of f.months.filter((x) => x >= f.ago(4))) add({ date: banking(f.on(m, 25), addDays), cents: PAY_CENTS + 8000, counterparty: "TOINEN ESIMERKKI OY", description: "PALKKA" });
    return out;
  },
  drop: (t, f) => t.counterparty === "ACME OY" && t.bookingDate >= f.on(f.ago(4), 1),
  // the new payer is a real change: the sentence that tells it is the point of the event
  allows: [/^income income:payer-changed:/],
};
