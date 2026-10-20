import { describe, expect, it } from "vitest";
import { addressKey, LoginLimiter, RateLimiter, RememberedAddresses } from "../src/security/rate-limit.ts";

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

  it("marks only the refusal of a full limiter as full", () => {
    const limiter = new RateLimiter(1, 15 * MIN, 1);
    expect(limiter.consume("a", 0)).toEqual({ wait: 0, first: false, full: false });
    expect(limiter.consume("a", 0)).toEqual({ wait: 900, first: true, full: false });
    expect(limiter.consume("b", 1000)).toEqual({ wait: 899, first: false, full: true });
    expect(limiter.holds("a", 0)).toBe(true);
    expect(limiter.holds("a", 15 * MIN)).toBe(false);
    expect(limiter.holds("b", 0)).toBe(false);
  });
});

describe("LoginLimiter: the spare for remembered addresses", () => {
  const now = 1_000_000;
  const REMEMBERED = true;
  const STRANGER = false;

  /** Limit 2, three keys in the main limiter and all of them over the limit, a spare of two. */
  function flooded() {
    const limiter = new LoginLimiter(2, 15 * MIN, 3, 2);
    for (const k of ["f1", "f2", "f3"]) for (let i = 0; i < 2; i++) limiter.consume(k, STRANGER, now);
    return limiter;
  }

  it("10 000 made-up keys lock the main limiter: a new key is refused, one from a remembered address is counted", () => {
    // the real sizes of the limit per user name and address
    const limiter = new LoginLimiter(10, 15 * MIN);
    let refused = 0;
    for (let n = 0; n < 10_000; n++) for (let i = 0; i < 10; i++) if (limiter.consume(`203.0.113.9|made-up-${n}`, STRANGER, now).wait) refused++;
    expect(refused).toBe(0);
    expect(limiter.size).toBe(10_000);
    expect(limiter.consume("198.51.100.7|aino", STRANGER, now + 1000)).toEqual({ wait: 899, first: false, full: true });
    expect(limiter.consume("192.0.2.10|aino", REMEMBERED, now + 1000)).toEqual({ wait: 0, first: false, full: false });
    expect(limiter.size).toBe(10_000);
    expect(limiter.spareSize).toBe(1);
    // the made-up names are as locked as before
    expect(limiter.consume("203.0.113.9|made-up-0", REMEMBERED, now + 1000).wait).toBe(899);
  });

  it("is not used while the main limiter has room: a remembered address is counted like any other", () => {
    const limiter = new LoginLimiter(2, 15 * MIN, 3, 2);
    expect(limiter.consume("a", REMEMBERED, now).wait).toBe(0);
    expect(limiter.consume("a", STRANGER, now).wait).toBe(0);
    expect(limiter.consume("a", REMEMBERED, now)).toEqual({ wait: 900, first: true, full: false });
    expect(limiter.consume("a", STRANGER, now).wait).toBe(900);
    expect(limiter.size).toBe(1);
    expect(limiter.spareSize).toBe(0);
  });

  it("has the same limit in the spare: a key is refused after `limit` attempts and the lockout is announced once", () => {
    const limiter = flooded();
    expect(limiter.consume("home", REMEMBERED, now).wait).toBe(0);
    expect(limiter.consume("home", REMEMBERED, now).wait).toBe(0);
    expect(limiter.consume("home", REMEMBERED, now)).toEqual({ wait: 900, first: true, full: false });
    expect(limiter.consume("home", REMEMBERED, now + 1000)).toEqual({ wait: 899, first: false, full: false });
    expect(limiter.check("home", now)).toBe(900);
    expect(limiter.spareSize).toBe(1);
  });

  it("ends no lockout: a key over its limit in the main limiter is refused for a remembered address too", () => {
    const limiter = flooded();
    expect(limiter.consume("f1", REMEMBERED, now + 1000)).toEqual({ wait: 899, first: true, full: false });
    expect(limiter.check("f1", now + 1000)).toBe(899);
    expect(limiter.spareSize).toBe(0);
  });

  it("takes no key from an attempt that is not from a remembered address", () => {
    const limiter = flooded();
    for (let i = 0; i < 50; i++) expect(limiter.consume(`new-${i}`, STRANGER, now)).toEqual({ wait: 900, first: false, full: true });
    expect(limiter.spareSize).toBe(0);
    expect(limiter.size).toBe(3);
  });

  it("gives a key one count: what the spare holds is counted there for every caller, also when the main limiter has room again", () => {
    // the limit per user name from all addresses: strangers and remembered addresses share the key
    const limiter = new LoginLimiter(3, 15 * MIN, 3, 2);
    for (const k of ["f1", "f2", "f3"]) for (let i = 0; i < 3; i++) limiter.consume(k, STRANGER, now);
    const later = now + 10 * MIN;
    expect(limiter.consume("aino", REMEMBERED, later).wait).toBe(0);
    expect(limiter.spareSize).toBe(1);
    // the flood's windows have ended and the main limiter takes new keys again
    const after = now + 16 * MIN;
    expect(limiter.consume("eero", STRANGER, after).wait).toBe(0);
    expect(limiter.size).toBe(1);
    // "aino" goes on in the spare: the second and third attempt of its window, then refused for everyone
    expect(limiter.consume("aino", STRANGER, after).wait).toBe(0);
    expect(limiter.consume("aino", REMEMBERED, after).wait).toBe(0);
    expect(limiter.consume("aino", STRANGER, after).wait).toBeGreaterThan(0);
    expect(limiter.consume("aino", REMEMBERED, after).wait).toBeGreaterThan(0);
    expect(limiter.size).toBe(1);
    expect(limiter.spareSize).toBe(1);
    // when that window ends the key is counted in the main limiter and nothing stays in the spare
    expect(limiter.consume("aino", STRANGER, later + 15 * MIN).wait).toBe(0);
    expect(limiter.size).toBe(2);
    expect(limiter.spareSize).toBe(0);
  });

  it("a clock set back does not wake an ended window of the spare beside the key's count in the main limiter", () => {
    const limiter = flooded();
    expect(limiter.consume("home", REMEMBERED, now).wait).toBe(0);
    const later = now + 15 * MIN;
    expect(limiter.consume("home", REMEMBERED, later).wait).toBe(0);
    expect(limiter.consume("home", REMEMBERED, later).wait).toBe(0);
    expect(limiter.spareSize).toBe(0);
    expect(limiter.consume("home", REMEMBERED, later - MIN).wait).toBeGreaterThan(0);
  });

  it("the spare is bounded and refuses a new key when every key it holds is over its limit", () => {
    const limiter = flooded();
    for (const k of ["h1", "h2"]) for (let i = 0; i < 2; i++) expect(limiter.consume(k, REMEMBERED, now).wait).toBe(0);
    for (let i = 0; i < 50; i++) expect(limiter.consume(`h-${i}`, REMEMBERED, now + 1000)).toEqual({ wait: 899, first: false, full: true });
    expect(limiter.spareSize).toBe(2);
    expect(limiter.size).toBe(3);
  });

  it("release and reset reach the key where it is counted", () => {
    const limiter = flooded();
    // a successful login gives its attempt back and leaves nothing in the spare
    limiter.consume("home", REMEMBERED, now);
    limiter.release("home", now);
    expect(limiter.spareSize).toBe(0);
    limiter.consume("home", REMEMBERED, now);
    limiter.consume("home", REMEMBERED, now);
    limiter.release("home", now);
    expect(limiter.consume("home", REMEMBERED, now).wait).toBe(0);
    expect(limiter.consume("home", REMEMBERED, now).wait).toBeGreaterThan(0);
    limiter.reset("home");
    expect(limiter.spareSize).toBe(0);
    // in the main limiter as before
    limiter.release("f1", now);
    expect(limiter.consume("f1", STRANGER, now).wait).toBe(0);
    expect(limiter.consume("f1", STRANGER, now).wait).toBeGreaterThan(0);
    limiter.reset("f1");
    expect(limiter.size).toBe(2);
  });
});

describe("RememberedAddresses", () => {
  const DAY = 24 * 3600_000;

  it("is bounded: the address that signed in longest ago goes first", () => {
    const seen = new RememberedAddresses(3);
    for (const [i, a] of ["a", "b", "c"].entries()) seen.add(a, i);
    // "a" signs in again and is now the newest
    seen.add("a", 10);
    seen.add("d", 11);
    expect(seen.size).toBe(3);
    expect(["a", "b", "c", "d"].map((a) => seen.has(a, 12))).toEqual([true, false, true, true]);
    for (let i = 0; i < 10_000; i++) seen.add(`x${i}`, 20 + i);
    expect(seen.size).toBe(3);
    expect(seen.has("a", 20_000)).toBe(false);
  });

  it("holds 100 addresses unless told otherwise", () => {
    const seen = new RememberedAddresses();
    for (let i = 0; i < 101; i++) seen.add(`a${i}`, i);
    expect(seen.size).toBe(100);
    expect(seen.has("a0", 200)).toBe(false);
    expect(seen.has("a1", 200)).toBe(true);
  });

  it("forgets an address 30 days after its last successful login", () => {
    const seen = new RememberedAddresses();
    expect(seen.has("home", 0)).toBe(false);
    seen.add("home", 0);
    expect(seen.has("home", 30 * DAY - 1)).toBe(true);
    expect(seen.has("home", 30 * DAY)).toBe(false);
    seen.add("home", 29 * DAY);
    expect(seen.has("home", 58 * DAY)).toBe(true);
    // an ended one is dropped when the next address is added
    seen.add("work", 70 * DAY);
    expect(seen.size).toBe(1);
    expect(seen.has("home", 70 * DAY)).toBe(false);
  });
});
