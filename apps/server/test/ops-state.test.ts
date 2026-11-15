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

describe("ops state: a check answer is one unit", () => {
  const release = { update_available: true, latest_version: "1.3.0", checked_at: "2026-11-14T10:00:00Z" };

  it("drops the release of an earlier check when a source answer comes without one", () => {
    const merged = mergeState(release, normaliseState({ update_available: true, behind_commits: [{ hash: "abc1234", subject: "Fix" }], checked_at: "2026-11-15T10:00:00Z" }));
    expect(merged).not.toHaveProperty("latest_version");
    expect(merged.behind_commits).toEqual([{ hash: "abc1234", subject: "Fix" }]);
  });

  it("drops the commits of an earlier source check when a release answer comes without them", () => {
    const stored = { update_available: true, behind_commits: [{ hash: "abc1234", subject: "Fix" }] };
    expect(mergeState(stored, normaliseState({ update_available: false, latest_version: "1.4.0" }))).toEqual({ update_available: false, latest_version: "1.4.0" });
  });

  it("keeps the answer when a report says nothing about the check", () => {
    expect(mergeState(release, normaliseState({ version: "1.4.0" }))).toMatchObject(release);
  });
});

describe("ops state: the version a system check ran under", () => {
  const doctor = (day: number) => ({ at: `2026-11-1${day}T10:00:00Z`, items: [{ id: "v", level: "ok", title: "Käynnissä", detail: "", hint: "" }] });

  it("takes the version the helper names", () => {
    expect(normaliseState({ doctor_version: "1.3.0" }).doctor_version).toBe("1.3.0");
    expect(normaliseState({ doctor_version: "v1.3" })).not.toHaveProperty("doctor_version");
  });

  it("takes the version of the report that first carries a new result, and keeps it while the result is the same", () => {
    const first = mergeState({}, normaliseState({ version: "1.3.0", doctor: doctor(4) }));
    expect(first.doctor_version).toBe("1.3.0");
    expect(mergeState(first, normaliseState({ version: "1.4.0", doctor: doctor(4) })).doctor_version).toBe("1.3.0");
    expect(mergeState(first, normaliseState({ version: "1.4.0", doctor: doctor(5) })).doctor_version).toBe("1.4.0");
  });

  it("prefers the version the helper names over the report's", () => {
    expect(mergeState({}, normaliseState({ version: "1.4.0", doctor_version: "1.3.0", doctor: doctor(4) })).doctor_version).toBe("1.3.0");
  });
});
