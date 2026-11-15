import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { rules } from "./css-kit.ts";

const sheet = (name: string) => rules(readFileSync(new URL(`../src/styles/${name}`, import.meta.url), "utf8"));

describe("the sign-in pages", () => {
  // The language picker is a label with .field, styled only by settings.css. Before a visit to Asetukset that sheet is
  // not loaded, the label is inline and its top margin is lost, so the picker touched the button above it.
  it("keeps the language picker apart from the button without the settings sheet", () => {
    const own = sheet("auth.css").filter((r) => r.selector === ".auth-language");
    expect(own.map((r) => r.body).join(";")).toMatch(/display: flex/);
    expect(own.map((r) => r.body).join(";")).toMatch(/margin-top: var\(--sp-16\)/);
  });
});
