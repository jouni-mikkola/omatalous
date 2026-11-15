import { describe, expect, it } from "vitest";

async function memoryApp() {
  const { openDatabase } = await import("../src/db/open.ts");
  const { createApp } = await import("../src/app.ts");
  const { loadConfig } = await import("../src/platform/config.ts");
  const { db } = await openDatabase(":memory:");
  return createApp({ db, config: loadConfig({ SETUP_CODE: "asennuskoodi-1234", PASSWORD_MEMORY_KIB: "8", PASSWORD_PASSES: "1" }) });
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
