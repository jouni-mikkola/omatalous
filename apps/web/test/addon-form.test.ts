/** Lisäosa: the code field and Tallenna koodi are drawn only while the server holds no code; Poista lisäosa stays while there is something to remove. */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AddOnCheck, AddOnForm, type FoundVersion } from "../src/pages/settings/AddOn.tsx";
import type { AddOnView } from "../src/pages/settings/addon-line.ts";

const html = (view: AddOnView, error: string | null = null) => renderToStaticMarkup(createElement(AddOnForm, { view, busy: null, error, onSend: async () => true }));
const checkHtml = (view: AddOnView, found?: FoundVersion) => renderToStaticMarkup(createElement(AddOnCheck, { view, busy: null, found, onCheck: () => {} }));
const hasCodeField = (out: string) => out.includes("Syötä lisäosan koodi");

describe("the form of the Lisäosa card", () => {
  it("asks for the code and the password while nothing is connected, and has no Poista lisäosa", () => {
    const out = html({ state: "none" });
    expect(hasCodeField(out)).toBe(true);
    expect(out).toContain("Tallenna koodi");
    expect(out).not.toContain("Poista lisäosa");
  });
  it("asks for the password only while the add-on is connected, and keeps Poista lisäosa", () => {
    const out = html({ state: "connected", id: "example", version: "1.2.0", label: "Esimerkki" });
    expect(hasCodeField(out)).toBe(false);
    expect(out).not.toContain("Tallenna koodi");
    expect(out).toContain("Salasanasi");
    expect(out).toContain("Poista lisäosa");
  });
  it("does not say where the add-on stands: the head of the card says it once", () => {
    expect(html({ state: "connected", id: "example", version: "1.2.0", label: "Esimerkki" })).not.toContain("Yhdistetty");
  });
  it("takes a code again once the module runs with none stored, and while a downloaded one waits for the restart it does not", () => {
    expect(hasCodeField(html({ state: "connected", id: "example", version: "1.2.0", noCode: true }))).toBe(true);
    expect(hasCodeField(html({ state: "pending", id: "example", version: "1.3.0" }))).toBe(false);
    for (const view of [{ state: "waiting" }, { state: "refused", reason: "signature does not verify" }, { state: "checking" }] as const) expect(hasCodeField(html(view)), view.state).toBe(true);
  });
  it("offers Tarkista päivitys while the server holds a code, and not when there is none", () => {
    for (const view of [{ state: "connected", id: "example", version: "1.2.0" }, { state: "pending", id: "example", version: "1.3.0" }, { state: "waiting" }, { state: "refused", reason: "x" }] as const) expect(checkHtml(view), view.state).toContain("Tarkista päivitys");
    expect(checkHtml({ state: "none" })).toBe("");
    expect(checkHtml({ state: "connected", id: "example", version: "1.2.0", noCode: true })).toBe("");
  });
  it("says plainly what a check found: a restart is needed, the version already runs, or nothing was installed", () => {
    const view = { state: "connected", id: "example", version: "1.2.0" } as const;
    expect(checkHtml(view)).not.toContain("role=\"status\"");
    expect(checkHtml(view, { version: "1.3.0", restart: true })).toContain("Uusin versio 1.3.0 on ladattu. Käynnistä palvelin uudelleen");
    expect(checkHtml(view, { version: "1.3.0", restart: false })).toContain("Uusin versio 1.3.0 on jo käytössä.");
    expect(checkHtml(view, null)).toContain("Tarkistus ei asentanut mitään");
  });
  it("shows the error of a call", () => {
    expect(html({ state: "none" }, "Väärä salasana.")).toContain("Väärä salasana.");
  });
});
