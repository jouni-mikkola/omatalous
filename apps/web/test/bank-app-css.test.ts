import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { rules } from "./css-kit.ts";

const settings = rules(readFileSync(new URL("../src/styles/settings.css", import.meta.url), "utf8"));

describe("Pankkisovellus", () => {
  // The card is a block with no gap, so the checklist under Talouden sovellus / Oma sovellus touched the choice.
  it("keeps a gap between the choice of the app and what it shows", () => {
    expect(settings.find((r) => r.selector === ".card > .segmented + *")?.body).toMatch(/margin-top: var\(--sp-12\)/);
  });
});
