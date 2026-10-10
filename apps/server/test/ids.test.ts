import { describe, expect, it } from "vitest";
import { stableId } from "../src/services/ids.ts";

/** What stableId returned before it used node:crypto: WebCrypto digest, first 12 bytes as hex. */
async function previousImplementation(text: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
  return Array.from(digest.slice(0, 12), (b) => b.toString(16).padStart(2, "0")).join("");
}

describe("stableId", () => {
  // ids written by the previous implementation: stored rows and accounts carry them, so they must not change
  const known: [string, string][] = [
    ["", "e3b0c44298fc1c149afbf4c8"],
    ["a", "ca978112ca1bbdcafac231b3"],
    ["acc-1|booked|x|abc123|0", "74d7bf2d516772b22062f490"],
    ["acc-1|booked|c|2026-03-04|-1250|K-MARKET ESPOO|KORTTIOSTO|2", "837af6a32d3aa43fdf09c5df"],
    ["csv-käyttäjä|csv|Säästötili ÅÄÖ", "8e37eb3243f72ad7c274cfbd"],
    ["u|csv|Tili 🙂", "1843be2f068818907768aab6"],
    ["eb-user|identity-hash", "d541441f0910c3670fa6c345"],
    ["demo|card", "46d9d3f1948e59b0d52c827a"],
  ];

  it.each(known)("gives the stored id for %j", (text, id) => {
    expect(stableId(text)).toBe(id);
  });

  it("matches the previous implementation on odd text, lone surrogates included", async () => {
    const samples = ["\ud800", "x\udc00y", "\u0000", "ä".repeat(500), "a|b|c|".repeat(100), "\u{1F600}\ud83d", "Ａｂｃ", "\r\n\t"];
    for (let i = 0; i < 200; i++) samples.push(Array.from({ length: i % 40 }, (_, j) => String.fromCharCode((i * 7919 + j * 104729) % 0xffff)).join(""));
    for (const text of samples) expect(stableId(text)).toBe(await previousImplementation(text));
  });

  it("is 24 hex characters", () => {
    expect(stableId("anything")).toMatch(/^[0-9a-f]{24}$/);
  });
});
