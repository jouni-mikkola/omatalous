import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ResetCard, ResetDone } from "../src/components/ops/ResetCard.tsx";
import { RestoreFacts, RestoreLatest } from "../src/components/ops/RestoreLatest.tsx";
import { confirmBody, formatSize, kindLabel,REQUEST_LAPSES_MS, restoreView, restoreWait, S, SLOW_MS, START_HELP } from "../src/components/ops/ops-strings.ts";
import type { ResetResult, RestoreState } from "../src/components/ops/types.ts";
import { dateTime } from "../src/format.ts";

const AT = "2026-10-09T03:00:00.000Z";
const auto: RestoreState = { copy: { name: "auto-2026-10-09.db", at: AT, size: 3_200_000, kind: "daily" }, pending: false };
const preReset: RestoreState = { copy: { name: "pre-reset-20261009T100000.db", at: AT, size: 3_200_000, kind: "pre-reset" }, pending: false };

const facts = (state: RestoreState | null, error: string | null = null) => renderToStaticMarkup(createElement(RestoreFacts, { state, error }));

describe("Palauta uusin varmuuskopio: the texts for a copy and for none", () => {
  it("names the copy by its time, size and file, and says what is lost", () => {
    const html = facts(auto);
    expect(html).toContain(dateTime(AT));
    expect(html).toContain("auto-2026-10-09.db");
    expect(html).toContain(formatSize(3_200_000));
    expect(html).toContain("Varmuuskopion jälkeen tehdyt muutokset häviävät. Pankkitapahtumat haetaan uudelleen seuraavassa haussa.");
    expect(html).toContain(S.restoreMistake);
    expect(html).not.toContain(S.restoreUndoesReset);
  });

  it("says in plain words that a pre-reset copy undoes a reset", () => {
    // the server says what the copy is; a name alone decides nothing on the page
    expect(facts({ ...preReset, copy: { ...preReset.copy!, kind: "manual" } })).toContain(S.restoreMistake);
    const html = facts(preReset);
    expect(html).toContain("juuri ennen tietojen tyhjennystä");
    expect(html).toContain("tuo tyhjennetyt tiedot takaisin");
    expect(html).not.toContain(S.restoreMistake);
  });

  it("with no intact copy says so and shows no time", () => {
    expect(restoreView({ copy: null, pending: false })).toBe("none");
    const html = facts({ copy: null, pending: false });
    expect(html).toContain("Ehjää varmuuskopiota ei ole.");
    expect(html).not.toContain("<button");
  });

  it("with a request waiting shows that and not the copy", () => {
    expect(restoreView({ ...auto, pending: true })).toBe("pending");
    const html = facts({ ...auto, pending: true });
    expect(html).toContain("Palautus on jo pyydetty.");
    expect(html).not.toContain("auto-2026-10-09.db");
  });

  it("before the answer the card reads nothing and offers no button; an error is shown as the server worded it", () => {
    expect(restoreView(null)).toBe("loading");
    expect(facts(null)).toContain("Haetaan uusinta varmuuskopiota…");
    expect(facts(null, "Palvelimeen ei saada yhteyttä. Yritä uudelleen.")).toContain("Palvelimeen ei saada yhteyttä.");
    const card = renderToStaticMarkup(createElement(RestoreLatest, { listKey: "", disabled: false }));
    expect(card).toContain("<h2>Palauta uusin varmuuskopio</h2>");
    expect(card).not.toContain("<button");
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
      "Varmuuskopio otetaan ensin, ja sen voi palauttaa vuorokauden ajan.",
      "Pankkiyhteydet pitää yhdistää uudelleen.",
    ]);
    const html = renderToStaticMarkup(createElement(ResetCard, { disabled: false }));
    for (const line of S.resetLines) expect(html).toContain(`<p>${line}</p>`);
    expect(html).toContain("<h2>Tyhjennä kaikki tiedot</h2>");
    expect(html).not.toMatch(/<ul|<li|card-sub|muted|small/);
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
