/**
 * The steps of the bank app say their state in words: "ei vielä tehty" for the undone, "valmis" for the done.
 */
import { createElement } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BankAppSetup } from "../src/pages/settings/BankAppSetup.tsx";
import { stubApi } from "./dom-kit.ts";
import type { InstanceState } from "../src/types.ts";

function state(configured: boolean): InstanceState {
  return {
    settings: { appBaseUrl: "http://localhost", timezone: "Europe/Helsinki", syncHours: [6], historyDays: 90, industryLookup: false, priceIndex: false, setupDone: true },
    bankApp: {
      source: configured ? "web" : null,
      appId: configured ? "12345678-abcd-1234-abcd-1234567890ab" : null,
      savedAt: configured ? "2026-01-01T00:00:00Z" : null,
      pendingSince: null,
      hasCertificate: configured,
      canStoreKeys: true,
      redirectUrl: "http://localhost/cb",
      redirectMode: "own",
      relayUrl: "",
      privacyUrl: "",
      termsUrl: "",
      inactiveMessage: null,
    },
    secret: { available: true },
  };
}

const items = () => [...document.querySelectorAll(".checklist li")];

describe("Pankkisovelluksen vaiheet", () => {
  it("marks every step of a setup with no key as not done yet", async () => {
    stubApi({ "GET /api/admin/bank-app/capabilities": { banks: [] } });
    render(createElement(BankAppSetup, { state: state(false), onState: () => {}, calm: true }));
    await screen.findByText("Salausavain luotu");
    expect(items()).toHaveLength(4);
    for (const li of items()) {
      expect(li.querySelector(".sr-only")?.textContent).toBe("ei vielä tehty: ");
      expect(li.classList.contains("done")).toBe(false);
    }
  }, 20000);

  it("marks all four steps of a configured app as done", async () => {
    stubApi({
      "GET /api/admin/bank-app/capabilities": { banks: [{ bankId: "x", consentDays: 90, requiredPsuHeaders: null, psuTypes: null, cardAccounts: false, pending: false, balanceTypes: ["CLBD"], historyDays: null }] },
    });
    render(createElement(BankAppSetup, { state: state(true), onState: () => {}, calm: true }));
    await screen.findByText("Pankkitilisi yhdistetty Enable Bankingissa");
    await waitFor(() => expect(items().at(-1)?.classList.contains("done")).toBe(true), { timeout: 5000 });
    expect(items()).toHaveLength(4);
    for (const li of items()) {
      expect(li.querySelector(".sr-only")?.textContent).toBe("Valmis: ");
      expect(li.classList.contains("done")).toBe(true);
    }
  }, 20000);
});
