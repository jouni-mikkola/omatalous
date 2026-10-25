import { describe, expect, it } from "vitest";
import { lineText, type OpenSync, shouldAsk } from "../src/open-sync.ts";

// the clock of the instance (Europe/Helsinki, +03:00 until 25.10.), not the machine's
const stamped = (day: number, h: number, min: number) => `2026-10-${String(day).padStart(2, "0")}T${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}:00+03:00`;
const NOW = new Date(stamped(13, 20, 0));
const at = (day: number, h: number, min: number) => new Date(stamped(day, h, min)).toISOString();
const answer = (o: Partial<OpenSync>): OpenSync => ({ state: "fresh", lastAt: null, inserted: 0, nextAt: null, ...o });

describe("the line at the top", () => {
  it("fresh, running, limited and failed say their sentence", () => {
    expect(lineText(answer({ state: "fresh", lastAt: at(13, 18, 42) }), NOW)).toBe("Tapahtumat päivitetty klo 18.42");
    expect(lineText(answer({ state: "running" }), NOW)).toBe("Haetaan tapahtumia pankista…");
    expect(lineText(answer({ state: "limited", lastAt: at(13, 6, 2), nextAt: at(13, 18, 0) }), NOW)).toBe(
      "Tapahtumat päivitetty klo 6.02. Pankki rajoittaa hakukertoja, seuraava haku klo 18.00.",
    );
    expect(lineText(answer({ state: "failed", lastAt: at(13, 6, 2) }), NOW)).toBe("Tapahtumien haku pankista epäonnistui. Edellinen haku klo 6.02.");
  });

  it("limited and failed without a last time drop that sentence", () => {
    expect(lineText(answer({ state: "limited", nextAt: at(13, 18, 0) }), NOW)).toBe("Pankki rajoittaa hakukertoja, seuraava haku klo 18.00.");
    expect(lineText(answer({ state: "failed" }), NOW)).toBe("Tapahtumien haku pankista epäonnistui.");
  });

  it("a time of another day has its date in front", () => {
    expect(lineText(answer({ state: "fresh", lastAt: at(12, 18, 2) }), NOW)).toBe("Tapahtumat päivitetty 12.10. klo 18.02");
    expect(lineText(answer({ state: "failed", lastAt: at(12, 18, 2) }), NOW)).toBe("Tapahtumien haku pankista epäonnistui. Edellinen haku 12.10. klo 18.02.");
  });

  it("no bank connection, or no answer, has no line", () => {
    expect(lineText(answer({ state: "none" }), NOW)).toBeNull();
    expect(lineText(null, NOW)).toBeNull();
  });
});

describe("when the page asks", () => {
  it("never asked: ask; 59 s: wait; 60 s: ask", () => {
    expect(shouldAsk(null, 1_000_000)).toBe(true);
    expect(shouldAsk(1_000_000, 1_059_000)).toBe(false);
    expect(shouldAsk(1_000_000, 1_060_000)).toBe(true);
  });
});
