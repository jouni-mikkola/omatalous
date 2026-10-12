import { describe, expect, it } from "vitest";
import { mergeState, normaliseState } from "../src/services/ops-validate.ts";

/**
 * lanAddress of the helper's state: where the copy would answer once remote access goes off. The page shows it to an
 * admin before the tunnel is taken away, so only one form passes: scheme, host and an optional port.
 */
describe("ops state: lanAddress", () => {
  const LONGEST = `http://${"abcdefgh.".repeat(11)}abcdefghi:8080`;

  it("is kept as an http or https URL of a host and an optional port", () => {
    expect(LONGEST).toHaveLength(120);
    for (const ok of ["http://192.168.1.10:8080", "http://localhost:8080", "http://[2001:db8::5]:8081", "http://[::1]:8080", "https://talous.example.fi", "http://nas:80", "http://nas:65535", LONGEST]) {
      expect(normaliseState({ lanAddress: ok }).lanAddress, ok).toBe(ok);
    }
  });

  it("is dropped in every other form", () => {
    const bad: unknown[] = [
      // no scheme, or another one
      "nas:8080", "//nas:80", "ftp://nas:80", "HTTP://nas", "javascript:alert(1)", "file:///etc/passwd",
      // more than a host and a port
      "http://nas:8080/", "http://nas/x", "http://nas:80?x=1", "http://nas:80#x", "http://a@nas", "http://a:b@nas:80",
      // no host, or a host that is no name and no address
      "http://", "http://:8080", "http://-nas", "http://nas-", "http://.nas", "http://n as", "http://nas\\x", 'http://nas"', "http://<b>", "http://[::1", "http://::1", "http://[::1]x", "http://[nas]", "http://[abc]",
      // a port outside 1 to 65535
      "http://nas:", "http://nas:0", "http://nas:65536", "http://nas:808080", "http://nas:8o",
      // white space around it, over 120 characters, nothing at all
      " http://nas:80", "http://nas:80 ", "http://nas:80\n", "http://nas:80\nhttp://nas:81", LONGEST.replace("i:8080", "ij:8080"), "",
      // not a string
      8080, null, true, ["http://nas"], { href: "http://nas" },
    ];
    for (const b of bad) expect(normaliseState({ lanAddress: b }), JSON.stringify(b)).not.toHaveProperty("lanAddress");
  });

  it("never passes on a secret or a long token-like run", () => {
    expect(normaliseState({ lanAddress: "http://abcdef0123456789:80" }, ["abcdef0123456789"])).not.toHaveProperty("lanAddress");
    expect(normaliseState({ lanAddress: "http://abcdef0123456789:80" }, ["another-secret-value"]).lanAddress).toBe("http://abcdef0123456789:80");
    expect(normaliseState({ lanAddress: `http://${"a1".repeat(20)}:80` })).not.toHaveProperty("lanAddress");
  });

  it("stays as stored when a report has no such field or a refused one, and follows a new one", () => {
    const stored = { mode: "tunnel", lanAddress: "http://192.168.1.10:8080" };
    expect(mergeState(stored, normaliseState({ mode: "tunnel", address: "https://talous.example.fi" }))).toEqual({ ...stored, address: "https://talous.example.fi" });
    expect(mergeState(stored, normaliseState({ lanAddress: "http://nas/x" })).lanAddress).toBe("http://192.168.1.10:8080");
    expect(mergeState(stored, normaliseState({ mode: "local", lanAddress: "http://localhost:8080" }))).toEqual({ mode: "local", lanAddress: "http://localhost:8080" });
  });

  it("is absent for a helper from before the field", () => {
    const older = { version: "0.8.6", mode: "lan", port: 8080, address: "http://192.168.1.10:8080", can_rollback: false, schema_changed: false };
    expect(normaliseState(older)).toEqual(older);
    expect(mergeState({ mode: "lan" }, normaliseState(older))).not.toHaveProperty("lanAddress");
  });
});
