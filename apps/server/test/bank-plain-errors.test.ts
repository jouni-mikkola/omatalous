/** What the browser is told when Enable Banking fails: plain words, and never an HTTP status code. */
import { describe, expect, it } from "vitest";
import { EnableBankingError, plainFault } from "../src/connectors/enable-banking/client.ts";
import { enableBanking } from "../src/connectors/enable-banking/connector.ts";

const STATUSES = [400, 401, 403, 404, 422, 429, 500, 502, 503];

describe("failures of Enable Banking", () => {
  it.each(STATUSES)("%i is told without its number, to the reader and in the fetch line", (status) => {
    const err = new EnableBankingError(status, JSON.stringify({ code: 0, error: "ASPSP_ERROR" }), "/accounts");
    expect(err.userMessage).toBe(plainFault(status));
    const problem = enableBanking.sync?.classify?.(err);
    for (const text of [err.userMessage, problem && "message" in problem ? problem.message : ""]) {
      expect(text ?? "").not.toMatch(/\b[1-5]\d\d\b/);
      expect(text ?? "").not.toMatch(/HTTP|ASPSP/);
    }
  });
  it("tells a limit from a fault at the other end", () => {
    expect(plainFault(429)).toContain("rajoitti");
    expect(plainFault(503)).toContain("ei vastaa");
  });
});
