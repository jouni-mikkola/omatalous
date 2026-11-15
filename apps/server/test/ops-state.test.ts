import { describe, expect, it } from "vitest";
import { mergeState, normaliseState } from "../src/services/ops-validate.ts";

/**
 * The helper's state keeps mode and address for the contracts of older helpers. The home network address that a helper
 * of the remote access days sent along (lanAddress) is dropped like any other key the app does not read.
 */
describe("ops state: mode and address", () => {
  it("keeps the mode and the address a helper reports", () => {
    expect(normaliseState({ mode: "tunnel", address: "https://talous.example.fi" })).toEqual({ mode: "tunnel", address: "https://talous.example.fi" });
  });

  it("drops lanAddress, which nothing reads any more", () => {
    expect(normaliseState({ mode: "lan", lanAddress: "http://192.168.1.10:8080" })).toEqual({ mode: "lan" });
  });

  it("stays as stored when a report has no such field, and follows a new one", () => {
    const stored = { mode: "tunnel", address: "https://talous.example.fi" };
    expect(mergeState(stored, normaliseState({}))).toEqual(stored);
    expect(mergeState(stored, normaliseState({ mode: "local", address: "http://localhost:8080" }))).toEqual({ mode: "local", address: "http://localhost:8080" });
  });

  it("is the same for a helper from before the fields", () => {
    const older = { version: "0.8.6", mode: "lan", port: 8080, address: "http://192.168.1.10:8080", can_rollback: false, schema_changed: false };
    expect(normaliseState(older)).toEqual(older);
  });
});
