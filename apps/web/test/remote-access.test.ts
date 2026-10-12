import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type RemoteAccessState, remoteAccessCalls, saveTokenFrom } from "../src/pages/settings/remote-access-api.ts";
import {
  afterOffKind,
  canRemoveToken,
  canTurnOff,
  canTurnOn,
  cleanHostname,
  clockTime,
  emailProblem,
  homeStoppedAnswering,
  isInstallerHost,
  isLocalAddress,
  needsLocalChoice,
  onTrial,
  parseEmails,
  pollDelay,
  stageOf,
  startEmails,
  startHostname,
  TOKEN_PAGE,
  TOKEN_PERMISSIONS,
  tokenNeededForOff,
  trialOverdue,
  tunnelHost,
  zoneList,
  zonesSentence,
} from "../src/pages/settings/remote-access-model.ts";
import { RemoteAccessBody, type RemoteAccessPoll } from "../src/pages/settings/RemoteAccess.tsx";
import { AfterOff, OffAsk, OnAsk, RemoveTokenAsk } from "../src/pages/settings/RemoteAccessAsk.tsx";

const TOKEN = "cfp_example-token-0123456789abcdefghijkl";
const PASSWORD = "esimerkki-salasana-1";

/** A copy with nothing set up: helper in order, no token, no tunnel. */
const OFF: RemoteAccessState = {
  copy: "talous",
  token: { saved: false, usable: false, savedAt: null, zones: [] },
  suggestedHostname: null,
  access: { on: false, hostname: null, address: "http://192.168.1.10:8080", mode: "lan", port: 8080, emails: [], emailsKnown: true, checked: false, confirmed: false, revertAt: null, afterOff: null },
  cloudflare: { hostname: null, emails: [], removal: null, note: null },
  pending: null,
  last: null,
  helper: { status: "ok", version: "3", knowsAccess: true, enableCommand: "./scripts/install.sh --ops-helper" },
  busy: false,
};
const SAVED = { saved: true, usable: true, savedAt: "2026-10-12T08:00:00.000Z", zones: ["example.fi"] };
const ON: RemoteAccessState = {
  ...OFF,
  token: SAVED,
  suggestedHostname: "talous.example.fi",
  access: {
    on: true,
    hostname: "talous.example.fi",
    address: "https://talous.example.fi",
    mode: "tunnel",
    port: 8080,
    emails: ["anna@example.fi", "matti@example.fi"],
    emailsKnown: true,
    checked: true,
    confirmed: true,
    revertAt: null,
    afterOff: "http://192.168.1.10:8080",
  },
  cloudflare: { hostname: "talous.example.fi", emails: ["anna@example.fi", "matti@example.fi"], removal: null, note: null },
  last: { want: "tunnel", hostname: "talous.example.fi", outcome: "applied", summary: "Valmis.", at: "2026-10-12T08:05:00.000Z" },
};
/** A new address on trial: on, and nobody has come in through it yet. */
const REVERT_AT = "2026-10-12T11:35:00.000Z";
const TRIAL: RemoteAccessState = { ...ON, access: { ...ON.access, confirmed: false, revertAt: REVERT_AT }, last: null };
const clock = (iso: string) => new Date(iso).toLocaleTimeString("fi-FI", { hour: "numeric", minute: "2-digit" });
const PENDING = { want: "tunnel", hostname: "talous.example.fi", requestId: "op_0123456789abcdef", status: "queued", requestedAt: "2026-10-12T08:00:00.000Z" } as const;

const poll = (data: RemoteAccessState | null, extra: Partial<RemoteAccessPoll> = {}): RemoteAccessPoll => ({
  data,
  error: null,
  errorStatus: null,
  downSince: null,
  reload: () => undefined,
  set: () => undefined,
  ...extra,
});
const page = (state: RemoteAccessState | null, extra: Partial<RemoteAccessPoll> = {}, now = Date.parse("2026-10-12T11:30:00.000Z")) =>
  renderToStaticMarkup(createElement(RemoteAccessBody, { poll: poll(state, extra), now }));

/** The address input of the form, as rendered ("" without a form). */
const hostField = (html: string) => /<input[^>]*name="hostname"[^>]*>/.exec(html)?.[0] ?? "";

describe("what the admin can do from the state", () => {
  it("names the stage: on, left over in Cloudflare, the copy's own domain, off", () => {
    expect(stageOf(OFF)).toBe("off");
    expect(stageOf(ON)).toBe("on");
    expect(stageOf({ ...ON, access: { ...ON.access, on: false, hostname: null, mode: "lan" } })).toBe("left");
    expect(stageOf({ ...OFF, access: { ...OFF.access, mode: "domain" } })).toBe("domain");
  });

  it("turns on only with the helper in order, a usable token, no domain copy and no change waiting (the server's own rule)", () => {
    const ready = { ...OFF, token: SAVED };
    expect(canTurnOn(ready)).toBe(true);
    expect(canTurnOn(OFF)).toBe(false);
    expect(canTurnOn({ ...ready, token: { ...SAVED, usable: false } })).toBe(false);
    expect(canTurnOn({ ...ready, helper: { ...ready.helper, status: "off" } })).toBe(false);
    expect(canTurnOn({ ...ready, helper: { ...ready.helper, knowsAccess: false } })).toBe(false);
    expect(canTurnOn({ ...ready, access: { ...ready.access, mode: "domain" } })).toBe(false);
    expect(canTurnOn({ ...ready, pending: PENDING })).toBe(false);
    expect(canTurnOn({ ...ready, cloudflare: { ...ready.cloudflare, removal: "waiting" } })).toBe(false);
    expect(canTurnOn({ ...ready, helper: { ...ready.helper, status: "slow" } })).toBe(true);
    // a host the installer made is refused by the server (409): the page does not offer the form for it
    expect(canTurnOn({ ...ON, access: { ...ON.access, emailsKnown: false, emails: [] } })).toBe(false);
    expect(canTurnOn(ON)).toBe(true);
  });

  it("turns off while something stands, unless a change waits or Cloudflare is already removing its side", () => {
    expect(canTurnOff(ON)).toBe(true);
    expect(canTurnOff(OFF)).toBe(false);
    expect(canTurnOff({ ...ON, pending: PENDING })).toBe(false);
    expect(canTurnOff({ ...ON, helper: { ...ON.helper, status: "off" } })).toBe(false);
    const left = { ...ON, access: { ...ON.access, on: false, mode: "lan" as const } };
    expect(canTurnOff(left)).toBe(true);
    // Cloudflare's own side goes without the helper
    expect(canTurnOff({ ...left, helper: { ...left.helper, status: "off", knowsAccess: false } })).toBe(true);
    expect(canTurnOff({ ...left, cloudflare: { ...left.cloudflare, removal: "waiting" } })).toBe(false);
  });

  it("polls soon while a change waits or a removal is under way, now and then otherwise", () => {
    expect(pollDelay(OFF)).toBe(60_000);
    expect(pollDelay({ ...ON, pending: PENDING })).toBe(3000);
    expect(pollDelay({ ...ON, cloudflare: { ...ON.cloudflare, removal: "waiting" } })).toBe(3000);
    expect(pollDelay({ ...ON, cloudflare: { ...ON.cloudflare, removal: "kept" } })).toBe(60_000);
    // a new address on trial ends when somebody comes in: look soon, also with nothing pending
    expect(pollDelay(TRIAL)).toBe(3000);
    expect(pollDelay(ON)).toBe(60_000);
  });

  it("knows a trial: on, and nobody has come in through the new address", () => {
    expect(onTrial(TRIAL)).toBe(true);
    expect(onTrial(ON)).toBe(false);
    // off is never a trial, whatever `confirmed` says
    expect(onTrial(OFF)).toBe(false);
    expect(trialOverdue(REVERT_AT, Date.parse(REVERT_AT) - 1)).toBe(false);
    expect(trialOverdue(REVERT_AT, Date.parse(REVERT_AT))).toBe(true);
    expect(trialOverdue(null, 0)).toBe(false);
    expect(clockTime(REVERT_AT)).toBe(clock(REVERT_AT));
    expect(clockTime(REVERT_AT)).toMatch(/^\d{1,2}[.:]\d{2}$/);
  });

  it("offers removing the token while nothing waits, and says that the off needs it while Cloudflare has a side", () => {
    expect(canRemoveToken({ ...OFF, token: SAVED })).toBe(true);
    expect(canRemoveToken({ ...ON, pending: PENDING })).toBe(false);
    expect(canRemoveToken({ ...ON, cloudflare: { ...ON.cloudflare, removal: "waiting" } })).toBe(false);
    expect(canRemoveToken({ ...ON, cloudflare: { ...ON.cloudflare, removal: "kept" } })).toBe(true);
    expect(tokenNeededForOff(ON)).toBe(true);
    expect(tokenNeededForOff({ ...ON, cloudflare: { hostname: null, emails: [], removal: "installer", note: "x" } })).toBe(false);
    expect(isInstallerHost({ ...ON, access: { ...ON.access, emailsKnown: false } })).toBe(true);
    expect(isInstallerHost(ON)).toBe(false);
  });

  it("asks for the explicit choice when the copy would answer on the server machine alone, or the helper does not say", () => {
    const after = (afterOff: string | null): RemoteAccessState => ({ ...ON, access: { ...ON.access, afterOff } });
    for (const local of ["http://localhost:8080", "https://localhost", "http://127.0.0.1:8080", "http://[::1]:8080", null]) {
      expect(afterOffKind(after(local)), String(local)).toBe("local");
      expect(needsLocalChoice(after(local)), String(local)).toBe(true);
    }
    for (const home of ["http://192.168.1.10:8080", "http://omatalous.lan:8080", "https://talous.koti.fi", "http://localhost.koti.fi:8080"]) {
      expect(afterOffKind(after(home)), home).toBe("home");
      expect(needsLocalChoice(after(home)), home).toBe(false);
    }
    expect(isLocalAddress("http://localhost:8080")).toBe(true);
    expect(isLocalAddress("http://192.168.1.10:8080")).toBe(false);
    // not behind the tunnel the off changes nothing about the copy's own address: no choice
    expect(needsLocalChoice({ ...ON, access: { ...ON.access, on: false, afterOff: null } })).toBe(false);
  });

  it("reads a 403 after a state as the home address no longer answering, and a 403 with none as a member", () => {
    expect(homeStoppedAnswering({ ...OFF, pending: { ...PENDING } }, 403)).toBe(true);
    expect(homeStoppedAnswering(ON, 403)).toBe(true);
    expect(homeStoppedAnswering(null, 403)).toBe(false);
    expect(homeStoppedAnswering(ON, 0)).toBe(false);
    expect(homeStoppedAnswering(OFF, 403)).toBe(false);
    expect(tunnelHost({ ...OFF, pending: { ...PENDING } })).toBe("talous.example.fi");
    expect(tunnelHost(OFF)).toBeNull();
  });

  it("starts the form from the suggestion, and keeps an address that exists", () => {
    expect(startHostname({ ...OFF, suggestedHostname: "talous.example.fi" })).toEqual({ host: "talous.example.fi", locked: false });
    expect(startHostname(ON)).toEqual({ host: "talous.example.fi", locked: true });
    expect(startHostname({ ...OFF, cloudflare: { hostname: "vanha.example.fi", emails: [], removal: "kept", note: null } })).toEqual({ host: "vanha.example.fi", locked: true });
    expect(startEmails(ON)).toEqual(["anna@example.fi", "matti@example.fi"]);
    // an installer-made host: the list is not known, so the form starts empty
    expect(startEmails({ ...ON, access: { ...ON.access, emails: [], emailsKnown: false }, cloudflare: { ...ON.cloudflare, emails: [] } })).toEqual([]);
  });
});

describe("the fields", () => {
  it("reads emails one a line, also when a comma, a semicolon or spaces separate them", () => {
    expect(parseEmails("anna@example.fi\n\n  matti@example.fi  \r\nliisa@example.fi, ville@example.fi; pekka@example.fi")).toEqual([
      "anna@example.fi",
      "matti@example.fi",
      "liisa@example.fi",
      "ville@example.fi",
      "pekka@example.fi",
    ]);
    expect(parseEmails("  \n ")).toEqual([]);
  });

  it("checks only that a line looks like an email, with the sentences of the server", () => {
    expect(emailProblem(["anna@example.fi"])).toBeNull();
    expect(emailProblem([])).toBe("Anna vähintään yksi sähköpostiosoite, jolla saa kirjautua.");
    expect(emailProblem(["anna@example.fi", "matti"])).toBe("Osoite 2 ei ole sähköpostiosoite.");
    expect(emailProblem(["anna@example"])).toBe("Osoite 1 ei ole sähköpostiosoite.");
    expect(emailProblem(Array.from({ length: 50 }, (_, i) => `a${i}@example.fi`))).toBeNull();
    expect(emailProblem(Array.from({ length: 51 }, (_, i) => `a${i}@example.fi`))).toBe("Sähköpostiosoitteita voi olla enintään 50.");
  });

  it("takes the address from a pasted link", () => {
    expect(cleanHostname(" https://Talous.Example.fi/ ")).toBe("talous.example.fi");
    expect(cleanHostname("talous.example.fi")).toBe("talous.example.fi");
    expect(cleanHostname("   ")).toBe("");
  });

  it("lists the zones by name, a few, and counts the rest", () => {
    expect(zoneList(["example.fi"])).toBe("example.fi");
    expect(zoneList(["example.fi", "example.net"])).toBe("example.fi ja example.net");
    expect(zoneList(["a.example.fi", "b.example.fi", "c.example.fi", "d.example.fi", "e.example.fi", "f.example.fi"])).toBe("a.example.fi, b.example.fi, c.example.fi, d.example.fi ja 2 muuta");
  });

  it("says verkkotunnuksen for one zone and verkkotunnukset for more", () => {
    expect(zonesSentence(["example.fi"])).toBe("Se näkee verkkotunnuksen example.fi.");
    expect(zonesSentence(["example.fi", "example.net"])).toBe("Se näkee verkkotunnukset example.fi ja example.net.");
    expect(zonesSentence([])).toBe("");
  });
});

describe("the blocks of each state", () => {
  it("off with no token: where things stand, the token field and its guide, and no form for the address", () => {
    const html = page(OFF);
    expect(html).toContain("Etäkäyttö ei ole käytössä.");
    expect(html).toContain("Sovelluksen osoite on nyt http://192.168.1.10:8080.");
    expect(html).toMatch(/name="cloudflare-api-token"/);
    expect(html).toMatch(/type="password"/);
    expect(html).toMatch(/autocomplete="off"/i);
    expect(html).toContain("Tallenna tunniste");
    expect(html).not.toContain('name="hostname"');
    expect(html).not.toContain("Ota etäkäyttö pois käytöstä");
  });

  it("calls the token Cloudflaren API-tunniste (API Token) where it first appears, and never an API key", () => {
    const html = page(OFF);
    const full = html.indexOf("Cloudflaren API-tunniste (API Token)");
    expect(full).toBeGreaterThan(0);
    expect(html.indexOf("API-tunniste")).toBe(full + "Cloudflaren ".length);
    for (const state of [OFF, ON, { ...ON, pending: PENDING }, { ...ON, token: { ...SAVED, usable: false } }]) expect(page(state).toLowerCase()).not.toContain("api-avain");
  });

  it("the guide: the plain token page, the five permissions by their Cloudflare names, Zero Trust, numbered steps", () => {
    const html = page(OFF);
    expect(html).toContain(`href="${TOKEN_PAGE}"`);
    expect(TOKEN_PAGE).toBe("https://dash.cloudflare.com/profile/api-tokens");
    expect(html).toContain("Create Token");
    expect(html).toContain("Custom token");
    expect(html).toContain("Zero Trust");
    expect(html).toMatch(/<details[^>]*>\s*<summary>[^<]+<\/summary>.*<ol/s);
    for (const name of TOKEN_PERMISSIONS) expect(html).toContain(`<code>${name.replace(/&/g, "&amp;")}</code>`);
    expect(TOKEN_PERMISSIONS).toHaveLength(5);
  });

  it("lists the permissions the server asks for (providers/cloudflare/api.ts), not a copy from memory", () => {
    const source = readFileSync(fileURLToPath(new URL("../../server/src/providers/cloudflare/api.ts", import.meta.url)), "utf8");
    const block = /export const PERMISSION = \{([^}]*)\}/s.exec(source)?.[1] ?? "";
    const server = [...block.matchAll(/:\s*"([^"]+)"/g)].map((m) => m[1]);
    expect(server).toHaveLength(5);
    expect([...TOKEN_PERMISSIONS].sort()).toEqual([...server].sort());
  });

  it("a saved token shows as saved with its zones and a remove button, and has no field", () => {
    const html = page({ ...OFF, token: SAVED, suggestedHostname: "talous.example.fi" });
    expect(html).toContain("Se näkee verkkotunnuksen example.fi.");
    expect(page({ ...OFF, token: { ...SAVED, zones: ["example.fi", "example.net"] } })).toContain("Se näkee verkkotunnukset example.fi ja example.net.");
    expect(html).toContain("Poista tunniste");
    expect(html).toContain("Vaihda tunniste");
    expect(html).not.toMatch(/name="cloudflare-api-token"/);
    // the form starts with the suggested address and no emails
    expect(hostField(html)).toContain('value="talous.example.fi"');
    expect(hostField(html)).not.toContain("readOnly");
    expect(html).toContain("Ota etäkäyttö käyttöön");
  });

  it("a token that no longer opens asks to be saved again and offers no form", () => {
    const html = page({ ...OFF, token: { ...SAVED, usable: false }, suggestedHostname: "talous.example.fi" });
    expect(html).toContain("Tallennettu tunniste ei enää aukea. Tallenna se uudelleen.");
    expect(html).toMatch(/name="cloudflare-api-token"/);
    expect(html).not.toContain('name="hostname"');
  });

  it("on: the address as a link, who may sign in, the list to change and, after the warning, the off button", () => {
    const html = page(ON);
    expect(html).toContain("Etäkäyttö on käytössä.");
    expect(html).toContain('<a href="https://talous.example.fi" target="_blank" rel="noopener noreferrer">https://talous.example.fi</a>');
    expect(html).toContain("<li>anna@example.fi</li>");
    expect(html).toContain("<li>matti@example.fi</li>");
    expect(html).toContain("Tallenna sallitut osoitteet");
    expect(hostField(html)).toContain("readOnly");
    expect(html).toContain("anna@example.fi\nmatti@example.fi</textarea>");
    const warning = html.indexOf("Kun etäkäyttö otetaan pois käytöstä, etäosoitteella avattu selain menettää yhteyden.");
    const after = html.indexOf("Tämän jälkeen Omatalous löytyy osoitteesta http://192.168.1.10:8080.");
    const button = html.indexOf(">Ota etäkäyttö pois käytöstä</button>");
    expect(warning).toBeGreaterThan(0);
    expect(after).toBeGreaterThan(warning);
    expect(button).toBeGreaterThan(after);
    // the token stays while remote access is on: the server refuses its removal, so the button is not offered
    expect(html).toContain("Tunniste tarvitaan, kun etäkäyttö otetaan pois käytöstä.");
    expect(html).not.toContain(">Poista tunniste</button>");
    expect(html).toContain("Vaihda tunniste");
    // a confirmed address is not on trial
    expect(html).not.toContain("kokeilussa");
  });

  it("on trial: the new address must be opened once through Cloudflare's sign-in before the clock time, or the server takes it off", () => {
    const html = page(TRIAL);
    expect(html).toContain("Uusi osoite on kokeilussa.");
    expect(html).not.toContain("Etäkäyttö on käytössä.");
    expect(html).toContain(`<a href="https://talous.example.fi" target="_blank" rel="noopener noreferrer">https://talous.example.fi</a> kerran ja kirjaudu sisään Cloudflaren kautta ennen kello ${clock(REVERT_AT)}.`);
    expect(html).toContain("Jos kukaan ei ole päässyt sisään siihen mennessä, palvelin ottaa osoitteen itse pois käytöstä, ja sovellus vastaa taas kotiverkon osoitteessa.");
    // the address and the list stay on show, and so does the way back
    expect(html).toContain("<li>anna@example.fi</li>");
    expect(html).toContain(">Ota etäkäyttö pois käytöstä</button>");
    // the moment before the helper's report is settled has no time yet
    const unsettled = page({ ...TRIAL, access: { ...TRIAL.access, revertAt: null } });
    expect(unsettled).toContain("kirjaudu sisään Cloudflaren kautta 15 minuutin kuluessa.");
    expect(unsettled).not.toContain("ennen kello");
    // the time has passed and the helper has not taken it off yet
    const late = page(TRIAL, {}, Date.parse(REVERT_AT) + 60_000);
    expect(late).toContain(`Kokeiluaika päättyi kello ${clock(REVERT_AT)}.`);
    expect(late).not.toContain("ennen kello");
    expect(late).toContain("palvelin ottaa osoitteen pois käytöstä heti, kun ylläpitoapuri ehtii.");
  });

  it("taken off by the server: says that it happened, for which address, and what to check", () => {
    const reverted = {
      ...OFF,
      token: SAVED,
      suggestedHostname: "talous.example.fi",
      last: {
        want: "tunnel" as const,
        hostname: "talous.example.fi",
        outcome: "reverted" as const,
        summary: "Etäkäyttö otettiin pois käytöstä, koska kukaan ei päässyt sisään uuden osoitteen kautta 15 minuutissa.",
        at: "2026-10-12T11:36:00.000Z",
      },
    };
    const html = page(reverted);
    expect(html).toContain("Uusi osoite ei toiminut, joten etäkäyttö otettiin pois käytöstä.");
    expect(html).toContain("Osoitteella talous.example.fi kukaan ei päässyt sisään 15 minuutissa. Sovellus vastaa taas kotiverkon osoitteessa.");
    expect(html).toContain("Tarkista, että sähköpostiosoitteet on kirjoitettu oikein ja että verkkotunnuksen DNS-asetukset ovat Cloudflaressa kunnossa.");
    expect(html).not.toContain("Edellinen muutos ei onnistunut.");
    // the form is there to try again
    expect(html).toContain('name="hostname"');
    // once it is on again the old outcome is not told over it
    expect(page({ ...TRIAL, last: reverted.last })).not.toContain("Uusi osoite ei toiminut");
  });

  it("the home address no longer answers: the page keeps what it knew and points to the remote address", () => {
    const html = page({ ...OFF, token: SAVED, pending: { ...PENDING } }, { error: "403 ", errorStatus: 403 });
    expect(html).toContain("Etäkäyttö on otettu käyttöön, eikä kotiverkon osoite enää vastaa.");
    expect(html).toContain('<a href="https://talous.example.fi" target="_blank" rel="noopener noreferrer">https://talous.example.fi</a>');
    expect(html).toContain("15 minuutin kuluessa");
    expect(html).toContain("Jos kukaan ei pääse sisään, palvelin ottaa osoitteen itse pois käytöstä");
    expect(html).toContain("Kun kotiverkon osoite vastaa taas, lataa tämä sivu uudelleen.");
    expect(html).not.toContain("403");
    expect(html).not.toContain('name="hostname"');
    // already proven: no trial words
    expect(page(ON, { errorStatus: 403 })).not.toContain("15 minuutin");
    // a member, who never had a state, still gets nothing
    expect(page(null, { errorStatus: 403 })).toBe("");
  });

  it("a first turning on that waits says that the home address stops answering once it is done", () => {
    const html = page({ ...OFF, token: SAVED, pending: { ...PENDING } });
    expect(html).toContain("Kun muutos on tehty, kotiverkon osoite ei enää vastaa. Avaa silloin https://talous.example.fi ja kirjaudu sisään Cloudflaren kautta 15 minuutin kuluessa.");
    // a change of the list for an address that is on already says nothing of the kind
    expect(page({ ...ON, pending: { ...PENDING } })).not.toContain("kotiverkon osoite ei enää vastaa");
  });

  it("a local-only copy and one the helper does not describe: said before the off button", () => {
    const local = { ...ON, access: { ...ON.access, afterOff: "http://localhost:8080" } };
    const html = page(local);
    expect(html).toContain("Tämän jälkeen Omatalous vastaa vain palvelimella itsellään, osoitteessa http://localhost:8080. Kotiverkon muut laitteet eivät pääse siihen.");
    expect(html).not.toContain("Omatalous löytyy osoitteesta");
    const unknown = page({ ...ON, access: { ...ON.access, afterOff: null } });
    expect(unknown).toContain("Ylläpitoapuri ei kerro, mistä osoitteesta Omatalous löytyy tämän jälkeen, joten se voi vastata vain palvelimella itsellään.");
  });

  it("on, made by the installer: no empty list as who may sign in, no form the server would refuse, and the way to turn it off", () => {
    const installer = { ...ON, access: { ...ON.access, emails: [], emailsKnown: false, checked: false }, cloudflare: { hostname: null, emails: [], removal: null, note: null } };
    const html = page(installer);
    expect(html).toContain("Lista on tehty palvelimella asennusohjelmalla, eikä se näy täällä.");
    expect(html).toContain("Tämän osoitteen etäkäyttö on tehty palvelimella asennusohjelmalla, eikä sitä voi muuttaa täältä. Muuta sitä palvelimella asennusohjelmalla (./scripts/install.sh).");
    expect(html).toContain("Sovellus ei tarkista itse, että kävijä on kirjautunut Cloudflaren kautta.");
    expect(html).not.toContain("<ul");
    expect(html).not.toContain("<textarea");
    expect(html).not.toContain('name="hostname"');
    expect(html).toContain(">Ota etäkäyttö pois käytöstä</button>");
    // on is on, whoever made it: the saved token stays
    expect(html).not.toContain(">Poista tunniste</button>");
    expect(html).toContain("Tunniste tarvitaan, kun etäkäyttö otetaan pois käytöstä.");
  });

  it("the installer's leftover in Cloudflare after an off: the server's note, as it sends it", () => {
    const note = "Tämän osoitteen on tehnyt Cloudflareen palvelimen asennusohjelma, joten tunneli, DNS-tietue ja kirjautumissuojaus (Access) jäivät sinne. Poista ne Cloudflaren hallinnasta tai palvelimen asennusohjelmalla.";
    const html = page({ ...OFF, token: SAVED, cloudflare: { hostname: null, emails: [], removal: "installer", note } });
    expect(html).toContain(note);
    expect(html).toContain("Etäkäyttö ei ole käytössä.");
    // a note is text: markup in it does not become markup
    const sneaky = page({ ...OFF, token: SAVED, cloudflare: { hostname: null, emails: [], removal: "installer", note: "<img src=x onerror=alert(1)>" } });
    expect(sneaky).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(sneaky).not.toContain("<img");
  });

  it("a change that waits: what it is, a way to withdraw it, and neither form nor off button", () => {
    const html = page({ ...ON, pending: PENDING });
    expect(html).toContain("Muutos odottaa ylläpitoapuria.");
    expect(html).toContain("Etäkäyttö otetaan käyttöön osoitteessa talous.example.fi.");
    expect(html).toContain("Peruuta muutos");
    expect(html).not.toContain('name="hostname"');
    expect(html).not.toContain("Ota etäkäyttö pois käytöstä");
    const running = page({ ...ON, pending: { ...PENDING, status: "running", want: "lan", hostname: null } });
    expect(running).toContain("Muutos on käynnissä.");
    expect(running).toContain("Etäkäyttö otetaan pois käytöstä.");
    expect(running).not.toContain("Peruuta muutos");
    // the token is not removed while a change waits, and the page says when it can be
    expect(html).not.toContain(">Poista tunniste</button>");
    expect(html).toContain("Tunnisteen voi poistaa, kun muutos on valmis.");
    expect(page({ ...ON, pending: PENDING }, { downSince: 1 })).toContain("Yhteys sovellukseen katkesi hetkeksi.");
    expect(page({ ...ON, pending: PENDING })).not.toContain("Yhteys sovellukseen katkesi");
  });

  it("a change that failed: the helper's summary as text, the date, and the form to try again", () => {
    const html = page({ ...OFF, token: SAVED, suggestedHostname: "talous.example.fi", last: { want: "tunnel", hostname: "talous.example.fi", outcome: "failed", summary: "Sovellus ei käynnistynyt <b>uudelleen</b>.", at: "2026-10-12T08:05:00.000Z" } });
    expect(html).toContain("Edellinen muutos ei onnistunut.");
    expect(html).toContain("Sovellus ei käynnistynyt &lt;b&gt;uudelleen&lt;/b&gt;.");
    expect(html).not.toContain("<b>");
    expect(html).toContain('name="hostname"');
  });

  it("Cloudflare's side left over: the server's own note, and the way to try again or take it away", () => {
    const note = "Osoitteeseen johtaa Cloudflaressa vielä jotain, mitä tämä asennus ei ole tehnyt, joten kirjautumissuojaus (Access) jätettiin päälle. Poista ylimääräinen tunneli tai DNS-tietue Cloudflaren hallinnasta ja ota etäkäyttö sitten uudelleen pois käytöstä.";
    const kept = { ...ON, access: { ...ON.access, on: false, mode: "lan" as const, hostname: null, address: "http://192.168.1.10:8080" }, cloudflare: { ...ON.cloudflare, removal: "kept" as const, note } };
    const html = page(kept);
    expect(html).toContain("Cloudflaressa on osoite talous.example.fi, mutta sovellus ei ole sen takana.");
    expect(html).toContain(note);
    expect(html).toContain("Ota etäkäyttö pois käytöstä");
    expect(hostField(html)).toContain("readOnly");
    // remote access is off here, so the token can go, and the page says what it is still needed for
    expect(html).toContain(">Poista tunniste</button>");
    expect(html).toContain("Tunniste tarvitaan, kun etäkäyttö otetaan pois käytöstä.");
    const waiting = page({ ...kept, cloudflare: { ...kept.cloudflare, removal: "waiting", note: "Cloudflaren puoli poistetaan, kun ylläpitoapuri on irrottanut asennuksen tunnelista." } });
    expect(waiting).toContain("Etäkäyttö otetaan pois käytöstä.");
    expect(waiting).not.toContain(">Poista tunniste</button>");
    expect(waiting).toContain("Cloudflaren puoli poistetaan, kun ylläpitoapuri on irrottanut asennuksen tunnelista.");
    expect(waiting).not.toContain("Ota etäkäyttö pois käytöstä");
    expect(hostField(waiting)).toBe("");
  });

  it("a helper that is missing or too old: one explanation, the command, the guide, and no form", () => {
    for (const helper of [{ ...OFF.helper, status: "off" as const, knowsAccess: false }, { ...OFF.helper, knowsAccess: false }]) {
      const html = page({ ...OFF, token: SAVED, helper, suggestedHostname: "talous.example.fi" });
      expect(html).toContain("./scripts/install.sh --ops-helper");
      expect(html).toContain("palvelimella asennusohjelmalla");
      expect(html).toMatch(/href="[^"]*docs\/ADVANCED\.md#cloudflare-tunnel"/);
      expect(html).not.toContain('name="hostname"');
    }
    expect(page({ ...OFF, helper: { ...OFF.helper, status: "off", knowsAccess: false } })).toContain("Ylläpitoapuri ei ole käytössä.");
    expect(page({ ...OFF, helper: { ...OFF.helper, knowsAccess: false } })).toContain("Ylläpitoapuri on liian vanha etäkäyttöön.");
  });

  it("a copy with its own domain gets the server's sentence and no token or form", () => {
    const html = page({ ...OFF, access: { ...OFF.access, mode: "domain" } });
    expect(html).toContain("Tällä asennuksella on oma verkkotunnus (Caddy), eikä etäkäyttöä oteta käyttöön sen rinnalle.");
    expect(html).not.toContain("API-tunniste");
    expect(html).not.toContain('name="hostname"');
  });

  it("a member gets nothing, and a state that cannot be read gets its error", () => {
    expect(page(null, { error: "Vain ylläpitäjä voi tehdä tämän.", errorStatus: 403 })).toBe("");
    expect(page(null, { error: "Kirjaudu sisään.", errorStatus: 401 })).toBe("");
    const failed = page(null, { error: "Palvelimeen ei saada yhteyttä. Yritä uudelleen.", errorStatus: 0 });
    expect(failed).toContain("Palvelimeen ei saada yhteyttä. Yritä uudelleen.");
    expect(failed).toContain("Etäkäyttö");
    expect(page(null)).toContain("Ladataan…");
  });
});

describe("the token", () => {
  const calls: { url: string; method: string; body: string }[] = [];
  const answer = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const stub = (respond: (url: string, method: string) => Response) =>
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
        calls.push({ url, method: init?.method ?? "GET", body: init?.body ?? "" });
        return respond(url, init?.method ?? "GET");
      }),
    );
  afterEach(() => {
    vi.unstubAllGlobals();
    calls.length = 0;
  });

  it("goes out once in the body of the save, the field is empty after it and no later request carries it", async () => {
    stub((url, method) => answer(200, method === "PUT" ? { ...OFF, token: SAVED } : OFF));
    const field = { value: TOKEN };
    const next = await saveTokenFrom(field, PASSWORD);
    expect(next.token.saved).toBe(true);
    expect(field.value).toBe("");
    // the next things the page asks for: a read, a change, a removal
    await remoteAccessCalls.turnOn("talous.example.fi", ["anna@example.fi"], PASSWORD);
    await remoteAccessCalls.removeToken(PASSWORD);
    await fetch("/api/admin/remote-access");
    const [save, ...later] = calls;
    expect(save).toMatchObject({ url: "/api/admin/remote-access/token", method: "PUT" });
    expect(JSON.parse(save!.body)).toEqual({ token: TOKEN, password: PASSWORD });
    expect(later).toHaveLength(3);
    for (const call of later) expect(JSON.stringify(call)).not.toContain(TOKEN);
    expect(calls.map((c) => c.url).join(" ")).not.toContain(TOKEN);
  });

  it("stays in the field after a refusal, and the message is the server's and holds no token", async () => {
    stub(() => answer(403, { error: "Salasana ei täsmää." }));
    const field = { value: TOKEN };
    const err = await saveTokenFrom(field, "väärä").catch((e: Error) => e);
    expect((err as Error).message).toBe("Salasana ei täsmää.");
    expect((err as Error).message + String(err)).not.toContain(TOKEN);
    expect(field.value).toBe(TOKEN);
  });

  it("is not read from or written to storage, the console or the address by the page", () => {
    const dir = fileURLToPath(new URL("../src/pages/settings/", import.meta.url));
    const names = readdirSync(dir).filter((f) => /^(RemoteAccess.*\.tsx|remote-access-.*\.ts)$/.test(f));
    expect(names.length).toBeGreaterThanOrEqual(9);
    for (const name of names) {
      const source = readFileSync(`${dir}${name}`, "utf8");
      expect(source, name).not.toMatch(/localStorage|sessionStorage|indexedDB|console\.|location\.(hash|search|href)|history\.(push|replace)State/);
    }
  });
});

describe("the answers of the server", () => {
  const calls: { url: string; method: string; headers: Record<string, string>; body: string }[] = [];
  const stub = (status: number, body: unknown) =>
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: { method?: string; body?: string; headers?: Record<string, string> }) => {
        calls.push({ url, method: init?.method ?? "GET", headers: init?.headers ?? {}, body: init?.body ?? "" });
        return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
      }),
    );
  afterEach(() => {
    vi.unstubAllGlobals();
    calls.length = 0;
  });

  it("removes the token with the password as JSON in the body", async () => {
    stub(200, OFF);
    await remoteAccessCalls.removeToken(PASSWORD);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ url: "/api/admin/remote-access/token", method: "DELETE" });
    expect(calls[0]!.headers["Content-Type"]).toBe("application/json");
    expect(calls[0]!.headers["X-Requested-With"]).toBe("fetch");
    expect(JSON.parse(calls[0]!.body)).toEqual({ password: PASSWORD });
  });

  it("sends localOnly: true only when the choice was made", async () => {
    stub(200, OFF);
    await remoteAccessCalls.turnOff(PASSWORD);
    await remoteAccessCalls.turnOff(PASSWORD, false);
    await remoteAccessCalls.turnOff(PASSWORD, true);
    expect(calls.map((c) => JSON.parse(c.body))).toEqual([{ password: PASSWORD }, { password: PASSWORD }, { password: PASSWORD, localOnly: true }]);
    expect(calls.every((c) => c.url === "/api/admin/remote-access/off" && c.method === "POST")).toBe(true);
  });

  // the 400, 403, 409 and 429 sentences of the routes, from the server's own list: shown as they come
  const ANSWERS: [number, string][] = [
    [400, "Virheellinen kenttä."],
    [400, "Etäkäyttö ei ole käytössä."],
    [400, "Kun etäkäyttö otetaan pois käytöstä, sovellus vastaa vain palvelimella itsellään osoitteessa http://localhost:8080. Vahvista, että tämä sopii."],
    [403, "Salasana ei täsmää."],
    [409, "Etäkäytön muutos on jo kesken. Odota, että se valmistuu."],
    [409, "Ylläpitoapuri ei ole vielä kertonut, onko asennus tunnelin takana. Yritä hetken päästä uudelleen."],
    [409, "Ylläpitoapuri ei ole käytössä."],
    [409, "Ylläpitoapurista on uudempi versio. Päivitä se palvelimella: ./scripts/install.sh --ops-helper"],
    [409, "Toinen toiminto on kesken."],
    [429, "Odota hetki ennen seuraavaa toimintoa."],
    [429, "Liian monta pyyntöä tunnissa. Yritä myöhemmin."],
  ];
  it.each(ANSWERS)("off: the %i answer is shown as it comes (%s)", async (status, sentence) => {
    stub(status, { error: sentence });
    await expect(remoteAccessCalls.turnOff(PASSWORD)).rejects.toMatchObject({ message: sentence, status });
  });

  it("removing the token while a change or a removal waits, or while remote access is on: the 409 sentence as it comes", async () => {
    const sentence = "Etäkäytön muutos on jo kesken. Odota, että se valmistuu.";
    stub(409, { error: sentence });
    await expect(remoteAccessCalls.removeToken(PASSWORD)).rejects.toMatchObject({ message: sentence, status: 409 });
    const whileOn = "Ota etäkäyttö ensin pois käytöstä. Tunniste tarvitaan siihen.";
    stub(409, { error: whileOn });
    await expect(remoteAccessCalls.removeToken(PASSWORD)).rejects.toMatchObject({ message: whileOn, status: 409 });
    stub(403, { error: "Salasana ei täsmää." });
    await expect(remoteAccessCalls.removeToken("väärä")).rejects.toMatchObject({ message: "Salasana ei täsmää.", status: 403 });
  });

  it("turning on: the server's sentence for a second change, as it comes", async () => {
    const sentence = "Etäkäytön muutos on jo kesken. Odota, että se valmistuu.";
    stub(409, { error: sentence });
    await expect(remoteAccessCalls.turnOn("talous.example.fi", ["anna@example.fi"], PASSWORD)).rejects.toMatchObject({ message: sentence, status: 409 });
  });
});

describe("the yes-step before the call", () => {
  const html = (node: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(node);
  const none = () => undefined;

  it("on: the address and every email back, that the home address stops answering, the trial, and the own address on the list", () => {
    const out = html(createElement(OnAsk, { changing: false, hostname: "talous.example.fi", emails: ["anna@example.fi", "matti@example.fi"] }));
    expect(out).toContain("<dd>https://talous.example.fi</dd>");
    expect(out).toContain("<li>anna@example.fi</li>");
    expect(out).toContain("<li>matti@example.fi</li>");
    expect(out).toContain("Kun etäkäyttö on päällä, kotiverkon osoite ei enää vastaa. Sovellukseen pääsee vain osoitteella https://talous.example.fi.");
    expect(out).toContain("Uusi osoite on ensin kokeilussa. Avaa se 15 minuutin kuluessa ja kirjaudu sisään Cloudflaren kautta jollakin listan osoitteella. Jos kukaan ei pääse sisään, palvelin ottaa etäkäytön itse pois käytöstä.");
    expect(out).toContain("Varmista, että oma sähköpostiosoitteesi on listalla");
  });

  it("a change of the list while it is on: the list back, and that this change is not on trial", () => {
    const out = html(createElement(OnAsk, { changing: true, hostname: "talous.example.fi", emails: ["anna@example.fi", "liisa@example.fi"] }));
    expect(out).toContain("<strong>https://talous.example.fi</strong> pääsee kirjautumaan vain näillä sähköpostiosoitteilla:");
    expect(out).toContain("<li>anna@example.fi</li>");
    expect(out).toContain("<li>liisa@example.fi</li>");
    expect(out).toContain("Tämä muutos ei ole kokeilussa. Lista on voimassa heti, ja jos omaa sähköpostiosoitettasi ei ole siinä, et pääse enää sisään.");
    expect(out).toContain("Poistettu osoite pääsee silti sisään, kunnes sen avoin kirjautuminen Cloudflaressa päättyy.");
    expect(out).not.toContain("Uusi osoite on ensin kokeilussa");
  });

  it("off with a home network address: where the app is found afterwards, and no box to tick", () => {
    const out = html(createElement(OffAsk, { s: ON, choice: false, onChoice: none }));
    expect(out).toContain("Etäosoitteella avattu selain menettää yhteyden.");
    expect(out).toContain("Tämän jälkeen Omatalous löytyy osoitteesta http://192.168.1.10:8080.");
    expect(out).not.toContain('type="checkbox"');
  });

  it("off that leaves the app on the server machine alone: says so and waits for an explicit choice", () => {
    const local = { ...ON, access: { ...ON.access, afterOff: "http://localhost:8080" } };
    const out = html(createElement(OffAsk, { s: local, choice: false, onChoice: none }));
    expect(out).toContain("Tämän jälkeen Omatalous vastaa vain palvelimella itsellään, osoitteessa http://localhost:8080. Kotiverkon muut laitteet eivät pääse siihen.");
    expect(out).toMatch(/<input type="checkbox"[^>]*required/);
    expect(out).not.toMatch(/<input type="checkbox"[^>]*checked=""/);
    expect(out).toContain("Ymmärrän tämän ja haluan ottaa etäkäytön pois käytöstä.");
    expect(html(createElement(OffAsk, { s: local, choice: true, onChoice: none }))).toMatch(/<input type="checkbox"[^>]*checked=""/);
    // the helper that does not report where the copy answers is the same case
    const unknown = html(createElement(OffAsk, { s: { ...ON, access: { ...ON.access, afterOff: null } }, choice: false, onChoice: none }));
    expect(unknown).toContain("Ylläpitoapuri ei kerro, mistä osoitteesta Omatalous löytyy tämän jälkeen");
    expect(unknown).toContain('type="checkbox"');
  });

  it("off for what only Cloudflare still has: nothing about the copy's own address and no box", () => {
    const left = { ...ON, access: { ...ON.access, on: false, mode: "lan" as const, afterOff: null } };
    const out = html(createElement(OffAsk, { s: left, choice: false, onChoice: none }));
    expect(out).toContain("Osoite poistetaan Cloudflaresta. Sovelluksen omaa osoitetta se ei muuta.");
    expect(out).not.toContain('type="checkbox"');
    expect(html(createElement(AfterOff, { s: ON }))).toBe("<p>Tämän jälkeen Omatalous löytyy osoitteesta http://192.168.1.10:8080.</p>");
  });

  it("removing the token: said first that Cloudflare's side cannot be removed without it", () => {
    expect(html(createElement(RemoveTokenAsk, { s: ON }))).toContain("Cloudflaren puolta (osoite talous.example.fi) ei voi poistaa ilman tunnistetta. Ota etäkäyttö ensin pois käytöstä.");
    expect(html(createElement(RemoveTokenAsk, { s: { ...OFF, token: SAVED } }))).not.toContain("ei voi poistaa ilman tunnistetta");
  });
});

describe("the words", () => {
  const RECEIPT = { want: "tunnel" as const, hostname: "talous.example.fi", outcome: "reverted" as const, summary: "x", at: "2026-10-12T11:36:00.000Z" };
  const states: RemoteAccessState[] = [
    OFF,
    { ...OFF, token: SAVED },
    { ...OFF, token: { ...SAVED, usable: false } },
    ON,
    TRIAL,
    { ...ON, pending: PENDING },
    { ...ON, pending: { ...PENDING, want: "lan", hostname: null, status: "running" } },
    { ...OFF, token: SAVED, last: RECEIPT },
    { ...OFF, token: SAVED, cloudflare: { hostname: "talous.example.fi", emails: [], removal: "waiting", note: "Cloudflaren puoli poistetaan, kun ylläpitoapuri on irrottanut asennuksen tunnelista." } },
    { ...ON, access: { ...ON.access, afterOff: "http://localhost:8080" } },
    { ...ON, access: { ...ON.access, emails: [], emailsKnown: false, checked: false } },
    { ...OFF, helper: { ...OFF.helper, status: "off", knowsAccess: false } },
  ];
  const texts = (): string[] => [
    ...states.map((s) => page(s)),
    page(TRIAL, {}, Date.parse(REVERT_AT) + 60_000),
    page({ ...OFF, pending: PENDING }, { errorStatus: 403 }),
    renderToStaticMarkup(createElement(OnAsk, { changing: false, hostname: "talous.example.fi", emails: ["anna@example.fi"] })),
    renderToStaticMarkup(createElement(OnAsk, { changing: true, hostname: "talous.example.fi", emails: ["anna@example.fi"] })),
    renderToStaticMarkup(createElement(OffAsk, { s: { ...ON, access: { ...ON.access, afterOff: null } }, choice: false, onChoice: () => undefined })),
    renderToStaticMarkup(createElement(RemoveTokenAsk, { s: ON })),
  ];

  it("the token is the API-tunniste, never an API key", () => {
    for (const out of texts()) expect(out.toLowerCase()).not.toContain("api-avain");
  });

  it("one phrase for the action: ota pois käytöstä", () => {
    for (const out of texts()) expect(out).not.toMatch(/Etäkäytön poist(o|aminen)\b|[Pp]oista etäkäyttö|etäkäyttö menee pois|Kytke|Sulje etäkäyttö/);
    const on = page(ON);
    expect(on).toContain("<h4 class=\"field-label\">Ota etäkäyttö pois käytöstä</h4>");
    expect(on).toContain(">Ota etäkäyttö pois käytöstä</button>");
    expect(on).toContain("Kun etäkäyttö otetaan pois käytöstä, ");
  });

  it("plain Finnish: no em dash, no ei X vaan Y, no exclamation mark, no tilitapahtuma", () => {
    for (const out of texts()) {
      expect(out).not.toContain(String.fromCharCode(8212));
      expect(out).not.toMatch(/\bei\b[^.<]{0,60}\bvaan\b/);
      expect(out).not.toContain("!");
      expect(out.toLowerCase()).not.toContain("tilitapahtuma");
    }
  });
});
