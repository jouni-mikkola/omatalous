import { describe, expect, it } from "vitest";
import { failureText, footText, type OpenSync, shouldAsk } from "../src/open-sync.ts";

// the clock of the instance (Europe/Helsinki, +03:00 until 25.10.), not the machine's
const stamped = (day: number, h: number, min: number) => `2026-10-${String(day).padStart(2, "0")}T${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}:00+03:00`;
const NOW = new Date(stamped(13, 20, 0));
const at = (day: number, h: number, min: number) => new Date(stamped(day, h, min)).toISOString();
const answer = (o: Partial<OpenSync>): OpenSync => ({ state: "fresh", lastAt: null, inserted: 0, nextAt: null, ...o });

describe("the foot of the page", () => {
  it("fresh, running and limited say their sentence", () => {
    expect(footText(answer({ state: "fresh", lastAt: at(13, 18, 42) }), NOW)).toBe("Päivitetty 13.10. klo 18.42");
    expect(footText(answer({ state: "running" }), NOW)).toBe("Haetaan tapahtumia pankista…");
    expect(footText(answer({ state: "limited", lastAt: at(13, 6, 2), nextAt: at(13, 18, 0) }), NOW)).toBe(
      "Päivitetty 13.10. klo 6.02. Pankki sallii seuraavan haun 13.10. klo 18.00",
    );
  });

  it("a half fetch says that some accounts were not fetched", () => {
    expect(footText(answer({ state: "partial", lastAt: at(13, 18, 42) }), NOW)).toBe("Päivitetty 13.10. klo 18.42. Kaikkien tilien tapahtumia ei saatu haettua");
  });

  it("a limit without a last time drops that sentence", () => {
    expect(footText(answer({ state: "limited", nextAt: at(13, 18, 0) }), NOW)).toBe("Pankki sallii seuraavan haun 13.10. klo 18.00");
  });

  it("a time of another day has its date and a time of another year its year", () => {
    expect(footText(answer({ state: "fresh", lastAt: at(12, 18, 2) }), NOW)).toBe("Päivitetty 12.10. klo 18.02");
    expect(footText(answer({ state: "fresh", lastAt: "2025-12-30T18:02:00+02:00" }), NOW)).toBe("Päivitetty 30.12.2025 klo 18.02");
  });

  it("a failed fetch, no bank connection and no answer leave the foot empty", () => {
    expect(footText(answer({ state: "failed", lastAt: at(13, 6, 2) }), NOW)).toBeNull();
    expect(footText(answer({ state: "none" }), NOW)).toBeNull();
    expect(footText(null, NOW)).toBeNull();
  });
});

describe("the exception at the top", () => {
  it("only a failed fetch rises to the top, with the time of the last one when there is one", () => {
    expect(failureText(answer({ state: "failed", lastAt: at(13, 6, 2) }), NOW)).toBe("Emme saaneet tapahtumia pankista. Edellinen haku 13.10. klo 6.02.");
    expect(failureText(answer({ state: "failed" }), NOW)).toBe("Emme saaneet tapahtumia pankista.");
    expect(failureText(answer({ state: "failed", lastAt: at(12, 18, 2) }), NOW)).toBe("Emme saaneet tapahtumia pankista. Edellinen haku 12.10. klo 18.02.");
  });

  it("a good fetch, a running one, the bank's limit, none and no answer say nothing there", () => {
    for (const state of ["fresh", "running", "limited", "none"] as const) expect(failureText(answer({ state, lastAt: at(13, 6, 2) }), NOW), state).toBeNull();
    expect(failureText(null, NOW)).toBeNull();
  });
});

describe("when the page asks", () => {
  it("never asked: ask; 59 s: wait; 60 s: ask", () => {
    expect(shouldAsk(null, 1_000_000)).toBe(true);
    expect(shouldAsk(1_000_000, 1_059_000)).toBe(false);
    expect(shouldAsk(1_000_000, 1_060_000)).toBe(true);
  });
});
