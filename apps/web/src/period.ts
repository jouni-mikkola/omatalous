import { addMonths, daysInMonth } from "@banking/core";

export const PERIODS = [
  { id: "month", label: "Tämä kuu" },
  { id: "last-month", label: "Viime kuu" },
  { id: "3m", label: "3 kk" },
  { id: "6m", label: "6 kk" },
  { id: "12m", label: "12 kk" },
  { id: "year", label: "Tämä vuosi" },
  { id: "last-year", label: "Viime vuosi" },
] as const;

/**
 * Preset id → inclusive date range, relative to the server's "today". 3, 6 and
 * 12 kk are the last whole months: a running month holds this month's bills
 * but not yet its salary, which would make a year look like a loss. The
 * running month is "Tämä kuu", and "Tämä vuosi" runs to today.
 */
export function periodRange(period: string, today: string): { from: string; to: string } {
  const month = today.slice(0, 7);
  const year = Number(today.slice(0, 4));
  const prev = addMonths(month, -1);
  const lastMonths = (n: number) => ({ from: `${addMonths(month, -n)}-01`, to: `${prev}-${daysInMonth(prev)}` });
  switch (period) {
    case "last-month":
      return lastMonths(1);
    case "3m":
      return lastMonths(3);
    case "6m":
      return lastMonths(6);
    case "12m":
      return lastMonths(12);
    case "year":
      return { from: `${year}-01-01`, to: today };
    case "last-year":
      return { from: `${year - 1}-01-01`, to: `${year - 1}-12-31` };
    default:
      return { from: `${month}-01`, to: today };
  }
}
