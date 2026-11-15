/** The setup page in English: none of its Finnish words is left. */
import { cleanup, render, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setLanguage } from "../src/format.ts";
import { Wizard, WizardDone, WizardSkip } from "../src/pages/Wizard.tsx";
import type { InstanceState, Meta } from "../src/types.ts";

const FINNISH = ["Käyttöönotto", "Aikavyöhyke", "ei vielä", "ei käytössä", "määritetty", "Osoite", "Salausavain", "kunnossa", "puuttuu", "Takaisin", "Siirry sovellukseen", "Yhdistä pankki", "Tee myöhemmin", "Valmis", "Tarkistus", "Jatka", "Automaattinen haku"];

function state(source: "web" | null, inactive: string | null, secret: boolean): InstanceState {
  return {
    settings: { appBaseUrl: "https://home.example", timezone: "Europe/Helsinki", syncHours: [6], historyDays: 90, industryLookup: false, setupDone: false },
    bankApp: { source, inactiveMessage: inactive } as unknown as InstanceState["bankApp"],
    secret: { available: secret },
  };
}

function text(s: InstanceState, linked: boolean): string {
  const { container } = render(createElement("div", null, createElement(WizardDone, { current: s, linked, finishing: false, onBack: () => {}, onFinish: () => {} }), createElement(WizardSkip, { disabled: false, onSkip: () => {} })));
  return container.textContent ?? "";
}

/** The whole page, with the server answering the instance state, at a step. */
async function page(step: number, s: InstanceState): Promise<string> {
  sessionStorage.setItem("wizard-step", String(step));
  vi.stubGlobal("fetch", async () => new Response(JSON.stringify(s), { status: 200, headers: { "Content-Type": "application/json" } }));
  const { container } = render(createElement(Wizard, { meta: { setupDone: false, bank: { source: null }, connections: [], accounts: [], lastSync: null } as unknown as Meta, onDone: () => {}, onSkip: () => {} }));
  await waitFor(() => expect(container.querySelector(".wizard-nav")).not.toBeNull());
  return container.textContent ?? "";
}

describe("Wizard in English", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    sessionStorage.clear();
    setLanguage("fi");
  });

  it("finds no Finnish word", () => {
    setLanguage("en");
    for (const s of [state(null, null, false), state("web", "x", true), state("web", null, true)]) {
      for (const linked of [false, true]) {
        const out = text(s, linked);
        for (const w of FINNISH) expect(out).not.toContain(w);
        cleanup();
      }
    }
  });

  it("renders the whole page in English at both steps", async () => {
    setLanguage("en");
    const base = state("web", null, true);
    base.settings.appBaseUrl = window.location.origin;
    for (const step of [0, 1]) {
      const out = await page(step, base);
      for (const w of [...FINNISH, "Vaiheet", "Ladataan", "Yksi sovellus", "Osoitteen"]) expect(out).not.toContain(w);
      expect(out).toContain(step === 0 ? "Setup" : "Time zone");
      cleanup();
    }
  });

  it("reads Finnish as before", () => {
    setLanguage("fi");
    const out = text(state(null, null, false), false);
    for (const w of ["Aikavyöhyke", "ei vielä", "puuttuu", "Siirry sovellukseen", "Tee myöhemmin"]) expect(out).toContain(w);
  });
});
