/** Säästövinkit's input form (components/optimise/Inputs.tsx), as Tarkistettavat asks it: an empty field has nothing to save. */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { InputForm } from "../src/components/optimise/Inputs.tsx";

const button = (current?: number) => {
  const html = renderToStaticMarkup(createElement(InputForm, { inputKey: "car_km", current, today: "2026-10-19", scope: "own", answer: () => undefined, waiting: false }));
  return html.match(/<button[^>]*type="submit"[^>]*>/)?.[0] ?? "";
};

describe("the input form's Tallenna", () => {
  it("waits for a value: disabled while the field is empty, enabled with one", () => {
    expect(button()).toContain("disabled");
    expect(button(14000)).not.toContain("disabled");
  });
});
