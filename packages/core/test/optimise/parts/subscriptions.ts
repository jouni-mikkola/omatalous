/**
 * Puhelin ja tilaukset. The hit: Elisa's phone bill rose 44,90 € → 56,90 € on 12.3.2026 after 12 charges (144 € a
 * year), Spotify 11,99 € and Tidal 10,99 € a month (dropping Tidal saves 131,88 € a year) and a Storytel yearly
 * subscription of 189 € that renews on 14.11.2026. Near misses: a 4 % rise, a family plan gaining a line (39,80 € →
 * 59,70 €, over 30 %), a phone bill that doubled, one video service, two music services under the gate, a renewal in 61 days and a renewal marked cancelled.
 */
import { addMonths, daysInMonth, monthRange } from "../../../src/dates.ts";
import type { InputValues } from "../../../src/optimise/types.ts";
import type { Transaction } from "../../../src/types.ts";
import type { Frame, Part, PartHousehold } from "../household.ts";

function rows(prefix: string) {
  const out: Transaction[] = [];
  const add = (bookingDate: string, amountCents: number, merchant: string, description: string) =>
    out.push({
      id: `${prefix}-${String(out.length).padStart(4, "0")}`,
      accountId: "h-chk",
      currency: "EUR",
      status: "booked",
      counterparty: null,
      counterpartyIban: null,
      description,
      mcc: null,
      merchant,
      category: "other",
      categorySource: "default",
      isTransfer: false,
      bookingDate,
      amountCents,
    });
  return { out, add };
}

const on = (month: string, day: number) => `${month}-${String(Math.min(day, daysInMonth(month))).padStart(2, "0")}`;

/** A charge on `day` of every month from `from` to the judging day, priced by month. */
function monthly(add: ReturnType<typeof rows>["add"], frame: Frame, from: string, day: number, merchant: string, description: string, cents: (month: string) => number) {
  for (const month of monthRange(from, addMonths(frame.months[frame.months.length - 1]!, 1))) {
    if (on(month, day) <= frame.today) add(on(month, day), -cents(month), merchant, description);
  }
}

export const hit: Part["hit"] = (frame) => {
  const { out, add } = rows("sub");
  monthly(add, frame, "2025-03", 12, "Elisa", "ELISA OYJ LASKU", (m) => (m < "2026-03" ? 4490 : 5690));
  monthly(add, frame, frame.months[0]!, 8, "Spotify", "SPOTIFY", () => 1199);
  monthly(add, frame, frame.months[0]!, 20, "Tidal", "TIDAL", () => 1099);
  add("2024-11-14", -18900, "Storytel", "STORYTEL");
  add("2025-11-14", -18900, "Storytel", "STORYTEL");
  return { txs: out };
};

export const nearMiss: Part["nearMiss"] = (frame): PartHousehold[] => {
  const rise = rows("sub-rise");
  // 25,00 € → 26,00 €: 1 € but 4 %
  monthly(rise.add, frame, "2025-03", 12, "Elisa", "ELISA OYJ LASKU", (m) => (m < "2026-03" ? 2500 : 2600));
  const family = rows("sub-family");
  // 39,80 € → 59,70 €: a third line at 19,90 € on a family plan, a step over 30 %
  monthly(family.add, frame, "2025-03", 14, "DNA", "DNA OYJ LASKU", (m) => (m < "2026-03" ? 3980 : 5970));
  const line = rows("sub-line");
  // 19,90 € → 39,80 €: a second line on the same bill
  monthly(line.add, frame, "2025-03", 12, "Elisa", "ELISA OYJ LASKU", (m) => (m < "2026-03" ? 1990 : 3980));
  const video = rows("sub-video");
  monthly(video.add, frame, frame.months[0]!, 12, "Netflix", "NETFLIX", () => 1599);
  const small = rows("sub-small");
  monthly(small.add, frame, frame.months[0]!, 8, "Spotify", "SPOTIFY", () => 599);
  monthly(small.add, frame, frame.months[0]!, 20, "Tidal", "TIDAL", () => 499);
  const later = rows("sub-later");
  // the next charge is 15.12.2026, 61 days after 15.10.2026
  later.add("2024-12-15", -18900, "Storytel", "STORYTEL");
  later.add("2025-12-15", -18900, "Storytel", "STORYTEL");
  const cancelled = rows("sub-cancelled");
  cancelled.add("2024-11-14", -18900, "Storytel", "STORYTEL");
  cancelled.add("2025-11-14", -18900, "Storytel", "STORYTEL");
  return [
    { txs: rise.out },
    { txs: family.out },
    { txs: line.out },
    { txs: video.out },
    { txs: small.out },
    { txs: later.out },
    { txs: cancelled.out, inputs: { marks: [{ subject: "merchant:Storytel", mark: "cancelled", markedAt: "2026-10-01T12:00:00" }], expectedBills: [] } },
  ];
};

export const neutralValues: InputValues = {};
