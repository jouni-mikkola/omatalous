/** The bank setup steps a person no longer does by hand (EB1): the certificate, the first save, and the buttons that stay on. */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { autoSaveWanted, startDownload } from "../src/pages/settings/BankAppSetup.tsx";
import { BankCapabilities, bankSeen } from "../src/pages/settings/BankCapabilities.tsx";
import { BankConnections } from "../src/pages/settings/BankConnections.tsx";
import { BankKey } from "../src/pages/settings/BankKey.tsx";
import { bankLinked, firstRunSteps } from "../src/components/EmptyStart.tsx";
import { WizardDone } from "../src/pages/Wizard.tsx";
import type { BankCapability, InstanceState, Meta } from "../src/types.ts";

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
const wizardDone = (current: InstanceState, linked = false) => renderToStaticMarkup(createElement(WizardDone, { current, linked, finishing: false, onBack: () => {}, onFinish: () => {} }));
const connectButton = (out: string) => out.match(/<button[^>]*btn-primary[^>]*>\s*Yhdistä pankki/)?.[0] ?? null;

describe("the wizard's last step", () => {
  it("keeps Yhdistä pankki on while the app reads Inactive, and says so", () => {
    const out = wizardDone(state("web", "Sovellus ei ole vielä aktiivinen."));
    expect(connectButton(out)).not.toBeNull();
    expect(connectButton(out)).not.toContain("disabled");
    expect(out).toContain("ei käytössä");
    expect(out).toContain("Sovellus ei ole vielä aktiivinen.");
  });
  it("has the button on for an active app and none before an app is set up", () => {
    expect(connectButton(wizardDone(state("web", null)))).not.toContain("disabled");
    expect(connectButton(wizardDone(state(null, null)))).toBeNull();
  });
});

describe("Valmis only with a bank linked", () => {
  it("says what is missing before a bank is linked and Valmis after", () => {
    expect(wizardDone(state("web", null))).toContain("Pankki puuttuu vielä");
    expect(wizardDone(state("web", null))).not.toContain("Valmis.");
    expect(wizardDone(state(null, null))).toContain("Enable Banking -sovellus ja pankki puuttuvat");
    expect(wizardDone(state("web", null), true)).toContain("Valmis. Pankki on yhdistetty.");
  });
});

describe("firstRunSteps", () => {
  const base = { bank: { source: null }, connections: [], lastSync: null } as unknown as Meta;
  const done = (m: Meta) => firstRunSteps(m).map((s) => s.done);
  it("ticks the app key, the bank and the first fetch in turn", () => {
    expect(done(base)).toEqual([false, false, false]);
    const app = { ...base, bank: { source: "user" } } as unknown as Meta;
    expect(done(app)).toEqual([true, false, false]);
    const linked = { ...app, connections: [{ state: "active", history: false }] } as unknown as Meta;
    expect(done(linked)).toEqual([true, true, false]);
    expect(done({ ...linked, lastSync: { status: "ok" } } as unknown as Meta)).toEqual([true, true, true]);
    expect(bankLinked(linked)).toBe(true);
  });
  it("does not count a lapsed or history connection as linked", () => {
    const m = { ...base, connections: [{ state: "lapsed", history: false }, { state: "active", history: true }] } as unknown as Meta;
    expect(bankLinked(m)).toBe(false);
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

describe("Oma Enable Banking -sovellus: its name strip", () => {
  const meta = { user: { role: "member" }, bank: { source: "user", canStoreOwnKeys: true, redirectUrl: "https://example.test/a", privacyUrl: "https://example.test/b", termsUrl: "https://example.test/c" } } as unknown as Meta;
  it("has the name strip every panel has, with the state under the name", () => {
    const out = renderToStaticMarkup(createElement(BankKey, { meta, onChange: () => {} }));
    expect(out).toContain('<summary class="card-head">');
    expect(out).toContain("<h2>Oma Enable Banking -sovellus</h2>");
    expect(out).toContain('<div class="card-sub">käytössä oma avain</div>');
  });
});

describe("Pankkien tiedot", () => {
  const none: BankCapability = { bankId: "nordea-fi", consentDays: null, requiredPsuHeaders: null, psuTypes: null, cardAccounts: false, pending: false, balanceTypes: [], historyDays: null };
  it("reads a fact not seen yet as ei vielä tiedossa and a seen one as its value", () => {
    const blank = renderToStaticMarkup(createElement(BankCapabilities, { banks: [none] }));
    expect(blank.match(/ei vielä tiedossa/g)).toHaveLength(6);
    const seen = renderToStaticMarkup(
      createElement(BankCapabilities, { banks: [{ ...none, consentDays: 180, cardAccounts: true, balanceTypes: ["CLAV", "ITAV"], historyDays: 90, requiredPsuHeaders: ["Psu-Ip-Address"] }] }),
    );
    expect(seen).toContain("180 päivää");
    expect(seen).toContain("CLAV, ITAV");
    expect(seen).toContain("90 päivää");
    expect(seen).toContain("Psu-Ip-Address");
    expect(seen.match(/ei vielä tiedossa/g)).toHaveLength(1);
  });
  it("draws nothing for no bank, and counts a bank as seen only after a link or a fetch", () => {
    expect(renderToStaticMarkup(createElement(BankCapabilities, { banks: [] }))).toBe("");
    expect(bankSeen({ ...none, consentDays: 180 })).toBe(false);
    expect(bankSeen({ ...none, pending: true })).toBe(true);
    expect(bankSeen({ ...none, historyDays: 0 })).toBe(true);
  });
});
