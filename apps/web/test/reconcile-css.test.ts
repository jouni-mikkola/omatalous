import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { rules } from "./css-kit.ts";

const css = rules(readFileSync(new URL("../src/styles/reconcile.css", import.meta.url), "utf8"));

describe("Täsmää pankin saldoon under an account", () => {
  // The line sits in the name's cell, a bold row head, so every status line was as heavy as the account name above it.
  it("is in the regular weight, with a fold or without one", () => {
    expect(css.find((r) => r.selector === ".acc-rec")?.body).toMatch(/font-weight: var\(--w-regular\)/);
  });
});
