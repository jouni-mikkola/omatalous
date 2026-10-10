import { inspect } from "node:util";
import { describe, expect, it } from "vitest";
import { EnableBankingError } from "../src/providers/enable-banking/client.ts";

describe("bank errors in the log", () => {
  const body = JSON.stringify({ code: 422, error: "ASPSP_ERROR", message: "Account FI2112345600000785 balance 1234.50" });

  it("keep the status, path and error code, nothing else of the response", () => {
    const err = new EnableBankingError(422, body, "/accounts/abc/transactions");
    expect(err.message).toBe("Enable Banking 422 on /accounts/abc/transactions ASPSP_ERROR");
    expect(inspect(err)).not.toContain("FI2112345600000785");
    expect(inspect(err)).not.toContain("1234.50");
  });

  it("still tells an expired consent from the body", () => {
    const err = new EnableBankingError(401, JSON.stringify({ error: "SESSION_EXPIRED" }), "/x");
    expect(err.consentExpired).toBe(true);
    expect(err.appRejected).toBe(false);
  });

  it("copes with a body that is not JSON", () => {
    expect(new EnableBankingError(502, "<html>Bad gateway</html>", "/x").message).toBe("Enable Banking 502 on /x");
  });
});
