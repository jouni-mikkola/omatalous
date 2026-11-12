import type { DoctorItem, OpsRequestView } from "../src/components/ops/types.ts";
import { diskItem, lastResult, newestBackup } from "../src/components/ops/ops-last.ts";
import { nextStep, remoteSummary } from "../src/pages/settings/remote-access-model.ts";
import type { RemoteAccessState } from "../src/pages/settings/remote-access-api.ts";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ResetCard, ResetDone } from "../src/components/ops/ResetCard.tsx";
import { BackupList, RestoreStatus } from "../src/components/ops/BackupList.tsx";
import { confirmBody, kindLabel, REQUEST_LAPSES_MS, restorable, restoreWait, S, SLOW_MS, START_HELP } from "../src/components/ops/ops-strings.ts";
import type { ResetResult, RestoreState } from "../src/components/ops/types.ts";
import { dateTime } from "../src/format.ts";

const AT = "2026-10-09T03:00:00.000Z";
const auto: RestoreState = { copy: { name: "auto-2026-10-09.db", at: AT, size: 3_200_000, kind: "daily" }, pending: false };

describe("the helper's state", () => {
  it("says the time it was seen with klo", () => {
    expect(S.helperOk("20.42")).toBe("Apuri toimii (nähty klo 20.42)");
  });
});

describe("Palauta, the row action of Varmuuskopiot", () => {
  it("is offered for the copy the server would take, and for none while it reads, when a request waits or no copy is intact", () => {
    expect(restorable(auto)).toEqual(auto.copy);
    expect(restorable(null)).toBeNull();
    expect(restorable({ ...auto, pending: true })).toBeNull();
    expect(restorable({ copy: null, pending: false })).toBeNull();
  });

  it("names the copy in the dialog by its time and says what is lost; a pre-reset copy also says it undoes a reset", () => {
    expect(S.restoreDialog(dateTime(AT))[0]).toContain(dateTime(AT));
    expect(S.restoreLoses).toContain("Varmuuskopion jälkeen tekemäsi muutokset häviävät.");
    expect(S.restoreUndoesReset).toContain("juuri ennen tietojen tyhjennystä");
    expect(S.restoreUndoesReset).toContain("tuo tyhjennetyt tiedot takaisin");
    expect(S.restoreMistake).not.toContain("tyhjennetyt");
  });

  it("before the first answer the list offers no button", () => {
    const html = renderToStaticMarkup(createElement(BackupList, { app: [{ name: auto.copy!.name, at: AT, size: 3_200_000, kind: "daily" }], host: [], disabled: false, restoreDisabled: false, canDownload: true, onBackup: () => {}, onDownload: () => {} }));
    expect(html).toContain(auto.copy!.name);
    expect(html).not.toContain(`>${S.restoreRow}<`);
  });

  it("after the request says what it waits for and gives the page back to the reader once the app answers", () => {
    const waiting = renderToStaticMarkup(createElement(RestoreStatus, { copy: auto.copy!, back: false, waited: 0, stillPending: null }));
    expect(waiting).toContain(S.restoreWaiting);
    expect(waiting).not.toContain("<button");
    const back = renderToStaticMarkup(createElement(RestoreStatus, { copy: auto.copy!, back: true, waited: 30_000, stillPending: false }));
    expect(back).toContain(S.restoreBack);
    expect(back).toContain(S.reload);
  });

  it("tells what to do when the app stays down, and that an old request lapses", () => {
    expect(restoreWait(0)).toEqual([S.restoreWaiting]);
    expect(restoreWait(SLOW_MS - 1)).toEqual([S.restoreWaiting]);
    const slow = restoreWait(SLOW_MS);
    expect(slow).toEqual([S.restoreSlow]);
    expect(slow[0]).toContain(START_HELP);
    const late = restoreWait(REQUEST_LAPSES_MS);
    expect(late).toEqual([S.restoreSlow, S.restoreLate]);
    expect(late[1]).toContain("15 minuuttia");
  });

  it("never says the restore was done", () => {
    for (const text of [S.restoreAsked(dateTime(AT)), S.restoreBack, S.restoreStillPending, S.restoreSlow, S.restoreLate]) {
      expect(text).not.toMatch(/palautettiin|palautettu|onnistui/i);
    }
    expect(S.restoreBack).toContain("tehtiinkö palautus");
  });
});

describe("the requests carry the password and the word and nothing else", () => {
  it("builds a body of exactly two fields for both cards", () => {
    const body = confirmBody("esimerkki-salasana-123", S.restoreWord);
    expect(Object.keys(body).sort()).toEqual(["confirm", "password"]);
    expect(body).toEqual({ password: "esimerkki-salasana-123", confirm: "PALAUTA" });
    expect(confirmBody("esimerkki-salasana-123", S.resetWord)).toEqual({ password: "esimerkki-salasana-123", confirm: "TYHJENNÄ" });
  });

  it("uses the words the server checks", () => {
    expect(S.restoreWord).toBe("PALAUTA");
    expect(S.resetWord).toBe("TYHJENNÄ");
  });
});

describe("Tyhjennä kaikki tiedot", () => {
  const result: ResetResult = { ok: true, copy: "pre-reset-20261009T100000.db", revoked: 2, failed: 0, message: "Tiedot on tyhjennetty. Kirjaudu sisään uudelleen." };
  const done = (r: ResetResult) => renderToStaticMarkup(createElement(ResetDone, { result: r }));

  it("after the answer shows the server's sentence, the copy and the way to sign in", () => {
    const html = done(result);
    expect(html).toContain("Tiedot on tyhjennetty. Kirjaudu sisään uudelleen.");
    expect(html).toContain("Varmuuskopio ennen tyhjennystä: pre-reset-20261009T100000.db");
    expect(html).toContain('href="/"');
    expect(html).toContain("Kirjaudu sisään");
    expect(html).not.toContain("jäi voimaan");
  });

  it("tells how many bank connections the bank kept", () => {
    expect(done({ ...result, failed: 1 })).toContain("1 pankkiyhteys jäi voimaan pankissa. Se vanhenee itsestään.");
    expect(done({ ...result, failed: 3 })).toContain("3 pankkiyhteyttä jäi voimaan pankissa. Ne vanhenevat itsestään.");
  });

  it("says before the click, in three lines of body text, what goes, that a copy is taken first and that the banks are connected again", () => {
    expect(S.resetLines).toEqual([
      "Poistaa tilit, tapahtumat, lainat, säännöt ja muut käyttäjät.",
      "Otamme ensin varmuuskopion, jonka voit palauttaa vuorokauden ajan.",
      "Pankkiyhteydet pitää yhdistää uudelleen.",
    ]);
    const html = renderToStaticMarkup(createElement(ResetCard, { disabled: false }));
    for (const line of S.resetLines) expect(html).toContain(`<p>${line}</p>`);
    expect(html).toContain("<h2>Tyhjennä kaikki tiedot</h2>");
    expect(html).not.toMatch(/<ul|<li|muted|small/);
    // the button opens the password dialog, which asks for the word TYHJENNÄ (e2e/ops.spec.ts drives it)
    expect(html).toContain(">Tyhjennä kaikki tiedot</button>");
    expect(html).not.toContain("<dialog");
    expect(S.resetWord).toBe("TYHJENNÄ");
  });

  it("the button is off while another request runs", () => {
    expect(renderToStaticMarkup(createElement(ResetCard, { disabled: true }))).toMatch(/<button[^>]*disabled=""[^>]*>Tyhjennä kaikki tiedot/);
    expect(renderToStaticMarkup(createElement(ResetCard, { disabled: false }))).not.toMatch(/<button[^>]*disabled/);
  });

  it("the list of copies names the one a reset made by what it is", () => {
    expect(kindLabel("pre-reset")).toBe("ennen tyhjennystä");
    expect(kindLabel("manual")).toBe("käsin");
    expect(kindLabel("daily")).toBe("päivittäinen");
  });

  it("uses one name for the copies", () => {
    // the cards' own keys; the older ones of the page still say "kopio" in places
    const mine = Object.entries(S).filter(([key]) => /^(restore|reset|signIn|reload)/.test(key));
    expect(mine.length).toBeGreaterThan(20);
    const all = JSON.stringify(mine);
    expect(all).not.toMatch(/(?<![a-zäö])kopio(?![a-zäö])/i);
  });
});

describe("the last result of an action", () => {
  const req = (status: OpsRequestView["status"], summary: string | null): OpsRequestView => ({ id: "a", action: "backup", label: "Varmuuskopio", status, by: null, requestedAt: AT, finishedAt: AT, summary, output: null, steps: [] });
  it("says when it last ended and how, or that it has not run", () => {
    expect(lastResult(undefined).text).toBe(S.neverRun);
    expect(lastResult(req("ok", "Kopio otettu")).text).toBe(`Viimeksi ${dateTime(AT)}: Onnistui`);
    expect(lastResult(req("failed", "Levy täynnä"))).toEqual({ text: `Viimeksi ${dateTime(AT)}: Epäonnistui. Levy täynnä`, tone: "warning" });
  });
  it("finds the disk line of the system check and the newest copy", () => {
    const item = (title: string): DoctorItem => ({ id: "", level: "warn", title, detail: "", hint: "" });
    expect(diskItem({ at: AT, items: [item("Docker"), item("Levy (kansio /x): vapaata 1 Gt")] })?.title).toContain("Levy");
    expect(diskItem(undefined)).toBeUndefined();
    expect(newestBackup([[{ at: "2026-01-01" }], [{ at: "2026-02-01" }]])).toBe("2026-02-01");
    expect(newestBackup([[], []])).toBeNull();
  });
});

describe("the next step of remote access", () => {
  it("names the first thing that is missing when it is off", () => {
    const s = { pending: null, access: { on: false, mode: null }, cloudflare: { hostname: null, removal: null }, helper: { status: "ok", knowsAccess: true }, token: { saved: false, usable: false } } as unknown as RemoteAccessState;
    expect(nextStep(s)).toContain("Tallenna Cloudflaren tunniste");
    expect(nextStep({ ...s, token: { saved: true, usable: true } } as RemoteAccessState)).toContain("ota etäkäyttö käyttöön");
    expect(remoteSummary(s)).toBe("pois käytöstä");
  });
});
