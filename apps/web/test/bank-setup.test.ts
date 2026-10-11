/** The bank setup steps a person no longer does by hand (EB1): the certificate, the first save, and the buttons that stay on. */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { autoSaveWanted, startDownload } from "../src/pages/settings/BankAppSetup.tsx";
import { BankConnections } from "../src/pages/settings/BankConnections.tsx";
import { BankKey } from "../src/pages/settings/BankKey.tsx";
import { WizardDone } from "../src/pages/Wizard.tsx";
import type { InstanceState, Meta } from "../src/types.ts";

describe("startDownload", () => {
  it("clicks a hidden link to the file and removes it again", () => {
    const link = { href: "", download: "x", hidden: false, click: vi.fn(), remove: vi.fn() };
    const body = { append: vi.fn() };
    startDownload("/api/admin/bank-app/certificate", { createElement: () => link, body } as unknown as Document);
    expect(link).toMatchObject({ href: "/api/admin/bank-app/certificate", download: "", hidden: true });
    expect(body.append).toHaveBeenCalledWith(link);
    expect(link.click).toHaveBeenCalledOnce();
    expect(link.remove).toHaveBeenCalledOnce();
  });
});

describe("autoSaveWanted", () => {
  const passed = { signature: "id|generate", result: { verified: true } };
  it("saves an Application ID whose test passed while no app is saved", () => {
    expect(autoSaveWanted(false, false, "id|generate", passed)).toBe(true);
  });
  it("leaves a saved app to the button", () => {
    expect(autoSaveWanted(true, false, "id|generate", passed)).toBe(false);
  });
  it("waits for a test that has not passed", () => {
    expect(autoSaveWanted(false, false, "id|generate", { signature: "id|generate", result: { verified: false } })).toBe(false);
    expect(autoSaveWanted(false, false, "id|generate", { signature: "id|generate", result: null })).toBe(false);
  });
  it("never saves an id that was typed after the test that passed", () => {
    expect(autoSaveWanted(false, false, "other|generate", passed)).toBe(false);
    expect(autoSaveWanted(false, false, "", passed)).toBe(false);
  });
  it("does not start a second save while one runs", () => {
    expect(autoSaveWanted(false, true, "id|generate", passed)).toBe(false);
  });
});

const state = (source: "web" | null, inactiveMessage: string | null) =>
  ({
    settings: { appBaseUrl: "https://talous.example", timezone: "Europe/Helsinki", syncHours: [6, 18] },
    secret: { available: true },
    bankApp: { source, inactiveMessage },
  }) as unknown as InstanceState;
const wizardDone = (current: InstanceState) => renderToStaticMarkup(createElement(WizardDone, { current, finishing: false, onBack: () => {}, onFinish: () => {} }));
const connectButton = (out: string) => out.match(/<button[^>]*btn-with-logo[^>]*>/)?.[0] ?? null;

describe("the wizard's last step", () => {
  it("keeps Lisää pankkiyhteys on while the app reads Inactive, and says so", () => {
    const out = wizardDone(state("web", "Sovellus ei ole vielä aktiivinen."));
    expect(connectButton(out)).not.toBeNull();
    expect(connectButton(out)).not.toContain("disabled");
    expect(out).toContain("ei aktiivinen");
    expect(out).toContain("Sovellus ei ole vielä aktiivinen.");
  });
  it("has the button on for an active app and none before an app is set up", () => {
    expect(connectButton(wizardDone(state("web", null)))).not.toContain("disabled");
    expect(connectButton(wizardDone(state(null, null)))).toBeNull();
  });
});

const BANKS = [{ id: "nordea-fi", name: "Nordea", country: "FI" }];
const picker = (bank: { configured: boolean; inactive?: boolean }) =>
  renderToStaticMarkup(
    createElement(BankConnections, {
      meta: { user: { role: "member" }, bank: { ...bank, banks: BANKS, redirectMode: "own" }, connections: [], accounts: [] } as unknown as Meta,
      pickerOpen: true,
      onChange: () => {},
      onMessage: () => {},
    }),
  );
const tile = (out: string) => out.match(/<button[^>]*bank-tile[^>]*>/)?.[0] ?? "";

describe("Pankkiyhteydet: the bank tile", () => {
  it("is on while the app reads Inactive, with the reason beside it", () => {
    const out = picker({ configured: false, inactive: true });
    expect(tile(out)).toContain("Yhdistä Nordea");
    expect(tile(out)).not.toContain("disabled");
    expect(out).toContain("Enable Banking ei vielä päästä sovellusta pankkeihin.");
  });
  it("is on for an app that works, and off until an app is set up", () => {
    expect(tile(picker({ configured: true }))).not.toContain("disabled");
    expect(tile(picker({ configured: false }))).toContain("disabled");
  });
});

describe("Oma Enable Banking -sovellus", () => {
  const meta = {
    user: { role: "member" },
    bank: { source: null, canStoreOwnKeys: true, redirectUrl: "https://relay.example/talous/callback/", privacyUrl: "https://relay.example/talous/privacy/", termsUrl: "https://relay.example/talous/terms/" },
  } as unknown as Meta;
  const out = renderToStaticMarkup(createElement(BankKey, { meta, onChange: () => {} }));

  it("lists the addresses the registration form asks for, each with a copy button", () => {
    for (const [label, url] of [
      ["Allowed redirect URLs", "https://relay.example/talous/callback/"],
      ["Privacy URL", "https://relay.example/talous/privacy/"],
      ["Terms URL", "https://relay.example/talous/terms/"],
    ] as const) {
      expect(out).toContain(`<code class="copyable" title="Kopioi">${url}</code>`);
      expect(out).toContain(`aria-label="Kopioi ${label}"`);
    }
  });
  it("saves with a test", () => {
    expect(out).toContain("Tallenna ja testaa");
  });
});
