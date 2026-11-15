import { describe, expect, it } from "vitest";
import { createContext } from "../src/analysis/context.ts";
import { openPriceRises } from "../src/analysis/price-rises.ts";
import { NO_INPUTS, type Transaction } from "../src/types.ts";
import { checking, household, monthly, today } from "./charge-fixtures.ts";

const risesOf = (txs: Transaction[]) => openPriceRises(createContext(txs, [checking], today), today, NO_INPUTS).map((r) => r.series.merchant);
const noRent = () => household().filter((t) => t.merchant !== "Vuokranantaja");

describe("openPriceRises", () => {
  it("an ordinary household has none", () => {
    expect(risesOf(household())).toEqual([]);
  });

  it("a fixed charge that got dearer is a rise; a step under 1 € or 5 % is rounding", () => {
    const elisa = monthly("2025-10", 7, 12, (i) => (i < 8 ? -10990 : -13990), { merchant: "Elisa", category: "telecom" });
    expect(risesOf([...household(), ...elisa])).toEqual(["Elisa"]);
    const small = monthly("2025-10", 7, 12, (i) => (i < 8 ? -2990 : -3050), { merchant: "Elisa", category: "telecom" });
    expect(risesOf([...household(), ...small])).toEqual([]);
  });

  it("a step over 30 % on a phone bill is a new plan or line, no price rise", () => {
    const line = monthly("2025-10", 7, 12, (i) => (i < 8 ? -3990 : -6990), { merchant: "Elisa", category: "telecom" });
    expect(risesOf([...household(), ...line])).toEqual([]);
  });

  it("a rent step over 10 % is a move or a new contract; a smaller one is a rise", () => {
    const rent = (to: number) => monthly("2024-04", 2, 30, (i) => (i < 24 ? -90000 : -to), { merchant: "Vuokranantaja", category: "housing" });
    expect(risesOf([...noRent(), ...rent(100000)])).toEqual([]);
    expect(risesOf([...noRent(), ...rent(94500)])).toEqual(["Vuokranantaja"]);
  });

  it("a municipal day-care fee follows income and hours: no price rise; a private one's is", () => {
    const fee = (merchant: string) => monthly("2024-04", 8, 30, (i) => (i < 28 ? -27990 : -33500), { merchant, category: "kids" });
    expect(risesOf([...household(), ...fee("Helsingin Kaupunki")])).toEqual([]);
    expect(risesOf([...household(), ...fee("Touhula Oy")])).toEqual(["Touhula Oy"]);
  });

  it("a vastike or a storage unit up 13 to 15 % is a rise; only rent steps over 10 % are a move", () => {
    const vastike = monthly("2024-04", 3, 30, (i) => (i < 24 ? -30000 : -33900), { merchant: "As Oy Kotikallio", description: "HOITOVASTIKE", category: "housing" });
    expect(risesOf([...household(), ...vastike])).toEqual(["As Oy Kotikallio"]);
    const storage = monthly("2024-04", 4, 30, (i) => (i < 24 ? -10000 : -11500), { merchant: "Pelican Self Storage", description: "VARASTON VUOKRA", category: "housing" });
    expect(risesOf([...household(), ...storage])).toEqual(["Pelican Self Storage"]);
  });

  it("rises that together add under 10 € a month to a year stay under the gate", () => {
    // 5 € a month dearer is 60 € a year, under the gate of 120 €
    const elisa = monthly("2025-10", 7, 12, (i) => (i < 8 ? -2990 : -3490), { merchant: "Elisa", category: "telecom" });
    expect(risesOf([...household(), ...elisa])).toEqual([]);
  });
});
