/** The port is read once: one rule for the address the server prints and the port it listens on. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { listenPort, loadConfig } from "../src/platform/config.ts";

afterEach(() => vi.restoreAllMocks());

describe("listenPort", () => {
  it.each(["8080abc", "0", "70000", "1.5", "-1"])("takes %s as 8080 with one warning naming PORT", (text) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(listenPort({ PORT: text })).toBe(8080);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain("PORT");
    warn.mockClear();
    expect(loadConfig({ PORT: text } as never).defaults.appBaseUrl).toBe("http://localhost:8080");
  });

  it("takes 3000 and an unset PORT without a warning", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(listenPort({ PORT: "3000" })).toBe(3000);
    expect(listenPort({})).toBe(8080);
    expect(loadConfig({ PORT: "3000" } as never).defaults.appBaseUrl).toBe("http://localhost:3000");
    expect(warn).not.toHaveBeenCalled();
  });
});
