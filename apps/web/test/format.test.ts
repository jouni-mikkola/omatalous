import { afterEach, describe, expect, it } from "vitest";
import { clockTime, date, dateTime, dayTime, eurosText, localDay, money, parseEuros, parseRate, rateText, roundedShares, setTimeZone, shareText, timeZone } from "../src/format.ts";
import { addedOn } from "../src/pages/settings/Members.tsx";
import { factRows } from "../src/pages/settings/SecondFactor.tsx";

describe("the texts of amount and rate inputs", () => {
  it("writes cents and hundredths of a percent as the household types them, with plain spaces", () => {
    expect(eurosText(12_345_678)).toBe("123 456,78");
    expect(eurosText(50)).toBe("0,50");
    expect(rateText(325)).toBe("3,25");
    expect(rateText(5)).toBe("0,05");
    expect(rateText(1000)).toBe("10,00");
  });

  it("reads what it wrote, and rounds a rate to hundredths, a half up", () => {
    for (const cents of [0, 1, 99_999, 12_345_678]) expect(parseEuros(eurosText(cents))).toBe(cents);
    for (const bp of [0, 5, 325, 5000]) expect(parseRate(rateText(bp))).toBe(bp);
    expect(parseRate("3.255 %")).toBe(326);
    expect(parseRate("3,254")).toBe(325);
    expect(parseRate("3,25 %")).toBe(325);
    expect(parseRate("neljä")).toBeNull();
    expect(parseRate("")).toBeNull();
  });
});

describe("roundedShares: shares of one whole printed side by side", () => {
  const cases: [string, (number | null)[], number, number, (number | null)[]][] = [
    ["the kind of split that printed 101 %: 47,6 / 37,8 / 14,6", [4760, 3780, 1460], 10_000, 0, [48, 38, 14]],
    ["three equal thirds, the first row takes the extra unit", [1, 1, 1], 3, 0, [34, 33, 33]],
    ["three equal thirds with one decimal", [1, 1, 1], 3, 1, [334, 333, 333]],
    ["three equal thirds with two decimals", [1, 1, 1], 3, 2, [3334, 3333, 3333]],
    ["a zero among the parts stays 0", [1, 0, 2], 3, 0, [33, 0, 67]],
    ["a part that is all of it", [10_000], 10_000, 0, [100]],
    ["parts under the whole add up to the nearest unit of their true sum", [3333, 3333], 10_000, 0, [34, 33]],
    ["a part that is null or below zero stands outside and the rest add up", [5000, null, -100, 5000], 10_000, 0, [50, null, null, 50]],
    ["no whole, no share", [5, 0, null], 0, 0, [0, 0, null]],
    ["one decimal that needs no rounding stays as it is", [4760, 3780, 1460], 10_000, 1, [476, 378, 146]],
  ];
  for (const [name, parts, whole, decimals, units] of cases) {
    it(name, () => expect(roundedShares(parts, whole, decimals)).toEqual(units));
  }

  it("takes the target a caller gives, so the parts of a part add up to the share that part printed", () => {
    // 30,0 and 17,4 are 47,4 together: on their own 47 %, but a group of 47,4 that went up to 48 % has parts adding up to 48
    expect(roundedShares([300, 174], 1000, 0)).toEqual([30, 17]);
    expect(roundedShares([300, 174], 1000, 0, 48)).toEqual([30, 18]);
  });

  it("writes units as the percent text, a comma before the decimals", () => {
    expect(shareText(48)).toBe("48 %");
    expect(shareText(476, 1)).toBe("47,6 %");
    expect(shareText(5, 2)).toBe("0,05 %");
    expect(shareText(10_000, 2)).toBe("100,00 %");
  });

  it("holds for a few hundred seeded splits: the parts add up, each is within one unit, a tie goes to the earlier row", () => {
    let seed = 20_261_013;
    const next = () => {
      seed = (seed * 1_664_525 + 1_013_904_223) % 4_294_967_296;
      return seed / 4_294_967_296;
    };
    for (let k = 0; k < 400; k++) {
      const n = 2 + Math.floor(next() * 7);
      const decimals = Math.floor(next() * 3);
      const equal = next() < 0.3;
      const base = 1 + Math.floor(next() * 500_000);
      const parts = Array.from({ length: n }, () => (equal ? base : next() < 0.15 ? 0 : 1 + Math.floor(next() * 500_000)));
      const hidden = next() < 0.3 ? 1 + Math.floor(next() * 400_000) : 0;
      const sum = parts.reduce((a, b) => a + b, 0);
      const whole = sum + hidden;
      const scale = 100 * 10 ** decimals;
      const out = roundedShares(parts, whole, decimals) as number[];
      const nearest = Math.floor((2 * sum * scale + whole) / (2 * whole));
      expect(out.reduce((a, b) => a + b, 0)).toBe(hidden ? nearest : scale);
      out.forEach((u, i) => {
        const floor = Math.floor((parts[i]! * scale) / whole);
        expect([floor, floor + 1]).toContain(u);
        if (parts[i] === 0) expect(u).toBe(0);
        // the same cents print the same, but the earlier row may take the unit the later one lacks
        for (let j = i + 1; j < n; j++) if (parts[j] === parts[i]) expect(u).toBeGreaterThanOrEqual(out[j]!);
      });
      expect(roundedShares(parts, whole, decimals)).toEqual(out);
    }
  });
});

describe("money", () => {
  it("writes zero without a sign, also when a negation made it -0", () => {
    expect(money(-0, false)).toBe(money(0, false));
    expect(money(-0)).toBe(money(0));
    expect(money(-0, false)).not.toMatch(/[−-]/);
    expect(money(-49, false)).not.toMatch(/[−-]/);
    expect(money(-100, false)).toMatch(/[−-]1/);
  });
});

describe("timestamps are read in the instance's time zone", () => {
  afterEach(() => setTimeZone("Europe/Helsinki"));

  it("reads a late evening in UTC as the next day in Helsinki, summer and winter time", () => {
    expect(date("2026-10-23T22:30:00Z")).toBe("24.10.2026");
    expect(date("2026-10-23T20:59:59Z")).toBe("23.10.2026");
    expect(date("2026-12-31T22:30:00Z")).toBe("1.1.2027");
    expect(date("2026-10-23T22:30:00.000+00:00")).toBe("24.10.2026");
    expect(localDay("2026-10-23T22:30:00Z")).toBe("2026-10-24");
    // a stamp already written with the local offset keeps its day
    expect(localDay("2026-10-24T01:30:00+03:00")).toBe("2026-10-24");
  });

  it("leaves a YYYY-MM-DD date as it is, whatever the zone", () => {
    for (const zone of ["Europe/Helsinki", "UTC", "Pacific/Auckland", "America/Los_Angeles"]) {
      setTimeZone(zone);
      expect(date("2026-10-23")).toBe("23.10.2026");
      expect(localDay("2026-10-23")).toBe("2026-10-23");
    }
  });

  it("gives the day and the clock of a timestamp together, and a dash for none", () => {
    expect(dateTime("2026-10-23T22:30:00Z")).toBe("24.10.2026 klo 1.30");
    expect(clockTime("2026-10-12T11:35:00Z")).toBe("14.35");
    expect(dayTime("2026-10-12T12:30:00Z")).toBe("12.10. klo 15.30");
    expect(date(null)).toBe("–");
    expect(dateTime(undefined)).toBe("–");
  });

  it("follows the zone the server names and ignores one the browser does not know", () => {
    setTimeZone("America/New_York");
    expect(dateTime("2026-10-23T22:30:00Z")).toBe("23.10.2026 klo 18.30");
    setTimeZone("Not/AZone");
    expect(timeZone()).toBe("America/New_York");
    setTimeZone(undefined);
    expect(timeZone()).toBe("America/New_York");
  });

  it("dates the second factor's start and the member's addition by the household's clock", () => {
    const rows = Object.fromEntries(factRows({ since: "2026-10-23T22:30:00Z", lastUsedAt: "2026-10-23T22:45:00Z", recoveryLeft: 10 }));
    expect(rows["Käytössä alkaen"]).toBe("24.10.2026");
    expect(rows["Viimeksi käytetty"]).toBe("24.10.2026 klo 1.45");
    expect(addedOn({ createdAt: "2026-10-23T22:30:00Z" })).toBe("24.10.2026");
  });
});
