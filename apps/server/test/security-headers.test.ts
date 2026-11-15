import { describe, expect, it } from "vitest";

async function memoryApp(env: Record<string, string> = {}) {
  const { openDatabase } = await import("../src/db/open.ts");
  const { createApp } = await import("../src/app.ts");
  const { loadConfig } = await import("../src/platform/config.ts");
  const { db } = await openDatabase(":memory:");
  return createApp({ db, config: loadConfig({ SETUP_CODE: "asennuskoodi-1234", PASSWORD_MEMORY_KIB: "8", PASSWORD_PASSES: "1", ...env }) });
}

describe("headers a browser honours only on a secure origin", () => {
  it("sends the opener policy and the agent cluster over https", async () => {
    const res = await (await memoryApp()).request("https://koti.example/api/health");
    expect(res.headers.get("cross-origin-opener-policy")).toBe("same-origin");
    expect(res.headers.get("origin-agent-cluster")).toBe("?1");
  });

  it("leaves them out over plain http and keeps the content policy", async () => {
    const res = await (await memoryApp()).request("http://192.168.1.20:8080/api/health");
    expect(res.headers.get("cross-origin-opener-policy")).toBeNull();
    expect(res.headers.get("origin-agent-cluster")).toBeNull();
    expect(res.headers.get("content-security-policy")).toContain("default-src 'self'");
  });
});

describe("the protocol a proxy names", () => {
  const address = { APP_BASE_URL: "https://koti.example" };
  const opener = async (env: Record<string, string>, url: string, forwarded?: string) =>
    (await (await memoryApp({ ...address, ...env })).request(url, { headers: forwarded ? { "X-Forwarded-Proto": forwarded } : {} })).headers.get("cross-origin-opener-policy");

  it("believes a trusted proxy that says https", async () => {
    expect(await opener({ TRUST_PROXY: "true" }, "http://192.168.1.20:8080/api/health", "https")).toBe("same-origin");
  });

  it("believes a trusted proxy that says http, also on the configured https address", async () => {
    expect(await opener({ TRUST_PROXY: "true" }, "http://koti.example/api/health", "http")).toBeNull();
  });

  it("ignores the header when no proxy is trusted", async () => {
    expect(await opener({}, "http://192.168.1.20:8080/api/health", "https")).toBeNull();
  });

  it("takes a direct http request to be plain http, and one to the configured https address to come through a proxy that sets no header", async () => {
    expect(await opener({ TRUST_PROXY: "true" }, "http://192.168.1.20:8080/api/health")).toBeNull();
    expect(await opener({ TRUST_PROXY: "true" }, "http://koti.example/api/health")).toBe("same-origin");
  });
});
