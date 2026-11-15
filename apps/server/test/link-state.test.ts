/** A stored link state that is broken counts as expired, and is taken either way. */
import { describe, expect, it } from "vitest";
import { AuthStateExpired, LINK_STATE_PREFIX, consumeLinkState } from "../src/connectors/link-state.ts";
import type { Services } from "../src/services/context.ts";

const NOW = 1_800_000_000_000;

function fake(initial: Record<string, string>) {
  const store = new Map(Object.entries(initial));
  const s = {
    now: () => new Date(NOW),
    settings: {
      take: async (key: string) => {
        const v = store.get(key) ?? null;
        store.delete(key);
        return v;
      },
    },
  } as unknown as Services;
  return { s, store };
}

const key = `${LINK_STATE_PREFIX}abc`;

describe("consumeLinkState", () => {
  it("returns when a good state was issued", async () => {
    const { s } = fake({ [key]: JSON.stringify({ userId: "u1", createdAt: NOW - 1000 }) });
    expect(await consumeLinkState(s, "u1", "abc")).toBe(NOW - 1000);
  });

  it("expires one of another user, and takes it", async () => {
    const { s, store } = fake({ [key]: JSON.stringify({ userId: "u2", createdAt: NOW }) });
    await expect(consumeLinkState(s, "u1", "abc")).rejects.toBeInstanceOf(AuthStateExpired);
    expect(store.has(key)).toBe(false);
  });

  it("expires an old one", async () => {
    const { s } = fake({ [key]: JSON.stringify({ userId: "u1", createdAt: NOW - 61 * 60_000 }) });
    await expect(consumeLinkState(s, "u1", "abc")).rejects.toBeInstanceOf(AuthStateExpired);
  });

  it.each([
    ["not JSON", "{half"],
    ["a number", "42"],
    ["null", "null"],
    ["a string", '"x"'],
    ["no userId", JSON.stringify({ createdAt: NOW })],
    ["a userId that is not text", JSON.stringify({ userId: 5, createdAt: NOW })],
    ["no createdAt", JSON.stringify({ userId: "u1" })],
    ["a createdAt that is not a number", JSON.stringify({ userId: "u1", createdAt: "now" })],
  ])("expires a value that is %s, and takes it", async (_name, raw) => {
    const { s, store } = fake({ [key]: raw });
    await expect(consumeLinkState(s, "u1", "abc")).rejects.toBeInstanceOf(AuthStateExpired);
    expect(store.has(key)).toBe(false);
    await expect(consumeLinkState(s, "u1", "abc")).rejects.toBeInstanceOf(AuthStateExpired);
  });
});
