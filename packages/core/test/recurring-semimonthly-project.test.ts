import { describe, expect, it } from "vitest";
import { detectRecurring, projectDates } from "../src/recurring.ts";
import { tx } from "./helpers.ts";

const pays = (days: string[]) => days.map((d, i) => tx({ bookingDate: d, amountCents: 178400 + (i % 3) * 1500, merchant: "Rakennus Oy", category: "salary" }));

describe("semimonthly projection", () => {
  it("a pay on the 15th and the month end keeps the month end", () => {
    const txs = pays(["2024-10-15", "2024-10-31", "2024-11-15", "2024-11-30", "2024-12-13", "2024-12-31", "2025-01-15", "2025-01-31", "2025-02-14", "2025-02-28"]);
    const [s] = detectRecurring(txs, "2025-03-05");
    expect(s).toMatchObject({ cadence: "semimonthly" });
    expect(["2025-03-14", "2025-03-15"]).toContain(s!.nextDate);
    const dates = projectDates(s!, "2025-05-31");
    expect(dates.filter((d) => d.slice(8) > "20")).toEqual(["2025-03-31", "2025-04-30", "2025-05-31"]);
    expect(dates.filter((d) => d.slice(8) <= "20").every((d) => ["14", "15"].includes(d.slice(8)))).toBe(true);
  });

  it("a pay on the 1st and the 15th still projects the 1st and the 15th", () => {
    const days: string[] = [];
    for (const m of ["2024-10", "2024-11", "2024-12", "2025-01", "2025-02"]) days.push(`${m}-01`, `${m}-15`);
    const [s] = detectRecurring(pays(days), "2025-03-05");
    const dates = projectDates(s!, "2025-05-31");
    expect(dates).toEqual(["2025-03-01", "2025-03-15", "2025-04-01", "2025-04-15", "2025-05-01", "2025-05-15"]);
  });
});
