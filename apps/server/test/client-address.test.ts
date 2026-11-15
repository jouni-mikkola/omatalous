/** A client address is an address: the port, brackets and non-addresses of a proxy header (auth/middleware.ts clientIp). */
import { describe, expect, it } from "vitest";
import type { Context } from "hono";
import { clientIp } from "../src/auth/middleware.ts";
import type { Services } from "../src/services/context.ts";
import { createServiceToken } from "../src/services/service-tokens.ts";
import { setupApp } from "./helpers.ts";

const ctx = (headers: Record<string, string>) =>
  ({
    req: { header: (n: string) => headers[n.toLowerCase()] },
    env: { incoming: { socket: { remoteAddress: "9.9.9.9" } } },
  }) as unknown as Context;
const svc = (trustProxy: boolean) => ({ config: { trustProxy } }) as unknown as Services;

describe("clientIp", () => {
  it("drops the port and the brackets", () => {
    expect(clientIp(ctx({ "cf-connecting-ip": "1.2.3.4:55" }), svc(true))).toBe("1.2.3.4");
    expect(clientIp(ctx({ "x-forwarded-for": "5.5.5.5, 1.2.3.4:55" }), svc(true))).toBe("1.2.3.4");
    expect(clientIp(ctx({ "cf-connecting-ip": "[2001:db8::1]:443" }), svc(true))).toBe("2001:db8::1");
    expect(clientIp(ctx({ "cf-connecting-ip": "2001:db8::1" }), svc(true))).toBe("2001:db8::1");
  });

  it("ignores a value that is no address and takes the next source", () => {
    for (const bad of ["example.com", "1.2.3.4, 5.6.7.8", "x".repeat(300), "999.1.1.1", "1.2.3.4:99999x"]) {
      expect(clientIp(ctx({ "cf-connecting-ip": bad, "x-forwarded-for": "7.7.7.7" }), svc(true)), bad).toBe("7.7.7.7");
      if (!bad.includes(",")) expect(clientIp(ctx({ "x-forwarded-for": bad }), svc(true)), bad).toBe("9.9.9.9");
    }
  });

  it("without TRUST_PROXY ignores both headers", () => {
    expect(clientIp(ctx({ "cf-connecting-ip": "1.2.3.4", "x-forwarded-for": "5.6.7.8" }), svc(false))).toBe("9.9.9.9");
  });
});

describe("service token limit by address", () => {
  it("20 wrong tokens from two source ports lock one address, and the 429 says how long", async () => {
    const { s, client } = await setupApp({ TRUST_PROXY: "true" });
    const { token } = await createServiceToken(s, { username: "aino", name: "agent" });
    const agent = client();
    const wrong = `omt_${"x".repeat(43)}`;
    for (let i = 0; i < 20; i++) {
      const port = i % 2 ? 55 : 56;
      const r = await agent.call("GET", "/api/meta", undefined, { Authorization: `Bearer ${wrong}`, "CF-Connecting-IP": `1.2.3.4:${port}` });
      expect(r.status).toBe(401);
    }
    const r = await agent.call("GET", "/api/meta", undefined, { Authorization: `Bearer ${token}`, "CF-Connecting-IP": "1.2.3.4:57" });
    expect(r.status).toBe(429);
    expect(Number(r.res.headers.get("retry-after"))).toBeGreaterThanOrEqual(1);
    expect(Number.isInteger(Number(r.res.headers.get("retry-after")))).toBe(true);
  });
});
