import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { rules } from "./css-kit.ts";

const settings = rules(readFileSync(new URL("../src/styles/settings.css", import.meta.url), "utf8"));

describe("Tiedot: the dry run of Tuo tiedot", () => {
  // The lines of the import sit in the row of buttons inside the card head. That row stayed beside the heading, so the
  // dry run filled the right half of the card and Tiedot stood alone in the middle of the left half.
  it("moves the buttons and their lines under the heading at the card's width", () => {
    expect(settings.find((r) => r.selector === ".card-head > .form-row:has(> .data-import-line)")?.body).toMatch(/flex: 1 1 100%/);
  });
});

describe("Tilit: the form of an account", () => {
  // Tilin nimi has a help line under its field. Aligned to the bottom, the row pushed the label Tyyppi below Tilin nimi.
  it("lines its fields up by the top, so the labels share a line", () => {
    expect(settings.find((r) => r.selector === ".account-form")?.body).toMatch(/align-items: start/);
  });
});
