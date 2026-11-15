/**
 * Asetukset > Palvelin: Tarkista päivitykset is off while the maintenance helper is not in use. The notice that says so
 * is in the Ylläpito card above, so the off button says why itself.
 */
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { UpdatePanel } from "../src/components/ops/UpdatePanel.tsx";
import { rules } from "./css-kit.ts";

const panel = (needsHelper: boolean) =>
  renderToStaticMarkup(createElement(UpdatePanel, { version: "0.10.0", build: "abc1234", state: {}, disabled: true, needsHelper, prerelease: null, onCheck: () => {}, onUpdate: () => {}, onRollback: () => {} }));
const button = (html: string) => /<button[^>]*>Tarkista päivitykset<\/button>/.exec(html)?.[0] ?? "";

describe("Versio: the off button says why", () => {
  it("names the helper beside the button and ties it to the button", () => {
    const html = panel(true);
    expect(html).toContain("Vaatii ylläpitoapurin.");
    const id = /aria-describedby="([^"]+)"/.exec(button(html))?.[1];
    expect(id).toBeTruthy();
    expect(html).toContain(`id="${id}"`);
  });

  it("says nothing more while the helper is in use", () => {
    const html = panel(false);
    expect(html).not.toContain("Vaatii ylläpitoapurin.");
    expect(button(html)).not.toContain("aria-describedby");
  });
});

describe("Turvallisuusloki: the filter", () => {
  // the longest kind made the select of Näytä 456 px wide at 1440 px
  it("keeps the select at a width a filter needs", () => {
    const css = rules(readFileSync(new URL("../src/styles/settings.css", import.meta.url), "utf8"));
    expect(css.find((r) => r.selector === ".field-inline select")?.body).toMatch(/max-width: min\(60vw, 18rem\)/);
  });
});
