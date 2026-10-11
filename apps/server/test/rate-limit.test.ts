import { describe, expect, it } from "vitest";
import { addressKey, RateLimiter } from "../src/security/rate-limit.ts";

const MIN = 60_000;

describe("addressKey", () => {
  it("keeps an IPv4 address as it is", () => {
    expect(addressKey("203.0.113.9")).toBe("203.0.113.9");
    expect(addressKey(" 203.0.113.10 ")).toBe("203.0.113.10");
  });

  it("counts an IPv4-mapped IPv6 address as the IPv4 address", () => {
    expect(addressKey("::ffff:203.0.113.9")).toBe("203.0.113.9");
    expect(addressKey("::FFFF:cb00:7109")).toBe("203.0.113.9");
    expect(addressKey("0:0:0:0:0:ffff:203.0.113.9")).toBe("203.0.113.9");
  });

  it("counts an IPv6 address by its /64, whatever way it is written", () => {
    const key = "2001:db8:1:2::/64";
    for (const a of ["2001:db8:1:2::1", "2001:0DB8:0001:0002:ffff:ffff:ffff:ffff", "[2001:db8:1:2::abcd]", "2001:db8:1:2:0:0:0:1%eth0", "2001:db8:1:2::192.0.2.1"]) {
      expect(addressKey(a)).toBe(key);
    }
    expect(addressKey("2001:db8:1:3::1")).toBe("2001:db8:1:3::/64");
    expect(addressKey("::1")).toBe("0:0:0:0::/64");
    expect(addressKey("fe80::1")).toBe("fe80:0:0:0::/64");
  });

  it("keeps anything else as it is, cut to the longest address length", () => {
    expect(addressKey("local")).toBe("local");
    expect(addressKey("2001:db8:::1")).toBe("2001:db8:::1");
    expect(addressKey("1:2:3:4:5:6:7:8:9")).toBe("1:2:3:4:5:6:7:8:9");
    expect(addressKey("x".repeat(500))).toHaveLength(45);
  });
});

describe("RateLimiter capacity", () => {
  it("stays at its size while a /64 is rotated through, and the rotation still hits the limit", () => {
    const limiter = new RateLimiter(50, 15 * MIN, 100);
    const now = 1_000_000;
    const waits = Array.from({ length: 1000 }, (_, i) => limiter.consume(addressKey(`2001:db8:1:2:${i.toString(16)}::1`), now).wait);
    expect(waits.slice(0, 50).every((w) => w === 0)).toBe(true);
    expect(waits.slice(50).every((w) => w > 0)).toBe(true);
    expect(limiter.size).toBe(1);
  });

  it("drops the oldest key under its limit to make room, never one that is over it", () => {
    const limiter = new RateLimiter(2, 15 * MIN, 3);
    const now = 1_000_000;
    limiter.consume("locked", now);
    limiter.consume("locked", now);
    limiter.consume("b", now + 1);
    limiter.consume("c", now + 2);
    expect(limiter.consume("d", now + 3).wait).toBe(0);
    expect(limiter.size).toBe(3);
    // "b" was the oldest key under its limit and starts again; "locked" is still refused
    expect(limiter.check("locked", now + 4)).toBeGreaterThan(0);
    expect(limiter.consume("locked", now + 4).wait).toBeGreaterThan(0);
    expect(limiter.consume("c", now + 4).wait).toBe(0);
    expect(limiter.check("c", now + 4)).toBeGreaterThan(0);
  });

  it("refuses a new key when every key held is over its limit, instead of letting it through", () => {
    const limiter = new RateLimiter(2, 15 * MIN, 3);
    const now = 1_000_000;
    for (const k of ["a", "b", "c"]) for (let i = 0; i < 2; i++) limiter.consume(k, now);
    for (let i = 0; i < 100; i++) {
      const attempt = limiter.consume(`new-${i}`, now + 1000);
      expect(attempt.wait).toBeGreaterThan(0);
      expect(attempt.first).toBe(false);
    }
    expect(limiter.size).toBe(3);
    for (const k of ["a", "b", "c"]) expect(limiter.consume(k, now + 1000).wait).toBeGreaterThan(0);
    // when the windows end there is room again
    expect(limiter.consume("new-0", now + 15 * MIN).wait).toBe(0);
  });

  it("makes room from ended windows first", () => {
    const limiter = new RateLimiter(2, MIN, 3);
    for (const [i, k] of ["a", "b", "c"].entries()) {
      limiter.consume(k, i);
      limiter.consume(k, i);
    }
    expect(limiter.consume("d", MIN + 1).wait).toBe(0);
    expect(limiter.size).toBe(2);
    expect(limiter.check("c", MIN + 1)).toBeGreaterThan(0);
  });

  it("a renewed window moves its key to the back, so it is not taken for the oldest", () => {
    const limiter = new RateLimiter(1, MIN, 2);
    limiter.consume("a", 0);
    limiter.consume("b", 10);
    // "a" starts a new window and is now newer than "b"
    expect(limiter.consume("a", MIN + 5).wait).toBe(0);
    // "b" has ended and goes first; "a" stays locked
    expect(limiter.consume("c", MIN + 20).wait).toBe(0);
    expect(limiter.check("a", MIN + 20)).toBeGreaterThan(0);
  });
});
