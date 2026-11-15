import type { DoctorItem, OpsRequestView } from "../src/components/ops/types.ts";
import { diskItem, lastResult } from "../src/components/ops/ops-last.ts";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ResetCard, ResetDone } from "../src/components/ops/ResetCard.tsx";
import { confirmBody, S } from "../src/components/ops/ops-strings.ts";
import type { ResetResult } from "../src/components/ops/types.ts";
import { dateTime } from "../src/format.ts";

const AT = "2026-10-09T03:00:00.000Z";

describe("the helper's state", () => {
  it("says the time it was seen with klo", () => {
    expect(S.helperOk("20.42")).toBe("Apuri toimii (nähty klo 20.42)");
  });
});

describe("the requests carry the password and the word and nothing else", () => {
  it("builds a body of exactly two fields", () => {
    const body = confirmBody("esimerkki-salasana-123", S.resetWord);
    expect(Object.keys(body).sort()).toEqual(["confirm", "password"]);
    expect(confirmBody("esimerkki-salasana-123", S.resetWord)).toEqual({ password: "esimerkki-salasana-123", confirm: "TYHJENNÄ" });
  });

  it("uses the words the server checks", () => {
    expect(S.resetWord).toBe("TYHJENNÄ");
  });
});

describe("Tyhjennä kaikki tiedot", () => {
  const result: ResetResult = { ok: true, copy: "pre-reset-20261009T100000.db", revoked: 2, failed: 0, message: "Tiedot on tyhjennetty. Kirjaudu sisään uudelleen." };
  const done = (r: ResetResult) => renderToStaticMarkup(createElement(ResetDone, { result: r }));

  it("after the answer shows the server's sentence, the copy and the way to sign in", () => {
    const html = done(result);
    expect(html).toContain("Tiedot on tyhjennetty. Kirjaudu sisään uudelleen.");
    expect(html).toContain("Kopio ennen tyhjennystä: pre-reset-20261009T100000.db");
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
      "Otamme ensin kopion tietokannasta.",
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

});

describe("the last result of an action", () => {
  const req = (status: OpsRequestView["status"], summary: string | null): OpsRequestView => ({ id: "a", action: "restart", label: "Uudelleenkäynnistys", status, by: null, requestedAt: AT, finishedAt: AT, summary, output: null, steps: [] });
  it("says when it last ended and how, and nothing for an action that has not run", () => {
    expect(lastResult(undefined)).toBeNull();
    expect(lastResult(req("ok", "Käynnistetty"))?.text).toBe(`Viimeksi ${dateTime(AT)}: Onnistui`);
    expect(lastResult(req("failed", "Levy täynnä"))).toEqual({ text: `Viimeksi ${dateTime(AT)}: Epäonnistui. Levy täynnä`, tone: "warning" });
  });
  it("finds the disk line of the system check", () => {
    const item = (title: string): DoctorItem => ({ id: "", level: "warn", title, detail: "", hint: "" });
    expect(diskItem({ at: AT, items: [item("Docker"), item("Levy (kansio /x): vapaata 1 Gt")] })?.title).toContain("Levy");
    expect(diskItem(undefined)).toBeUndefined();
  });
});
