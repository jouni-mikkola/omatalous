import { createServer } from "node:http";
import { describe, expect, it } from "vitest";
import { HEADERS_TIMEOUT_MS, KEEP_ALIVE_TIMEOUT_MS, applyServerTimeouts } from "../src/entry/server-timeouts.ts";

describe("server timeouts", () => {
  it("keeps an idle connection longer than the proxy's 90 s, and the header limit above that", () => {
    const server = createServer();
    const requestTimeout = server.requestTimeout;
    applyServerTimeouts(server);
    expect(server.keepAliveTimeout).toBe(KEEP_ALIVE_TIMEOUT_MS);
    expect(server.keepAliveTimeout).toBeGreaterThan(90_000);
    expect(server.headersTimeout).toBe(HEADERS_TIMEOUT_MS);
    expect(server.headersTimeout).toBeGreaterThan(server.keepAliveTimeout);
    expect(server.requestTimeout).toBe(requestTimeout);
  });

  it("leaves a server without these settings alone", () => {
    const other = {};
    applyServerTimeouts(other);
    expect(other).toEqual({});
  });
});
