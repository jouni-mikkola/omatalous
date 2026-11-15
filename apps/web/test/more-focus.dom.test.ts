/**
 * The buttons under a cut list: the press that shows the last items removes "Näytä lisää" and the press that folds the
 * list removes "Näytä vähemmän". The focus stays on a button of the list each time, and the count is spoken after a
 * press, never before one.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { expect, it } from "vitest";
import "./dom-kit.ts";
import { useMore } from "../src/components/More.tsx";

const ITEMS = Array.from({ length: 5 }, (_, i) => `rivi ${i + 1}`);

/** A list of three pages: 2, 4 and then all 5 items. */
function List() {
  const { shown, more } = useMore(ITEMS, 2);
  return createElement("div", { "data-list": "" }, createElement("ul", null, ...shown.map((s) => createElement("li", { key: s }, s))), more);
}

/** Presses the button as a person does: the focus is on it when it is pressed. */
function press(name: RegExp) {
  const button = screen.getByRole("button", { name });
  button.focus();
  fireEvent.click(button);
}

const onListButton = () => document.activeElement instanceof HTMLButtonElement && document.querySelector("[data-list]")!.contains(document.activeElement);

it("keeps the focus on a button of the list and speaks the count after each press", () => {
  render(createElement(List));
  const live = screen.getByRole("status");
  expect(live.getAttribute("aria-live")).toBe("polite");
  // silent until a button is pressed
  expect(live.textContent).toBe("");

  press(/^Näytä \d+ lisää$/);
  expect(screen.getAllByRole("listitem")).toHaveLength(4);
  expect(onListButton()).toBe(true);
  expect(live.textContent).toMatch(/4 \/ 5/);

  // the last page: "Näytä lisää" is gone, the focus is on "Näytä vähemmän"
  press(/^Näytä \d+ lisää$/);
  expect(screen.getAllByRole("listitem")).toHaveLength(5);
  expect(screen.queryByRole("button", { name: /^Näytä \d+ lisää$/ })).toBeNull();
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "Näytä vähemmän" }));
  expect(live.textContent).toMatch(/5 \/ 5/);

  // folded: "Näytä vähemmän" is gone, the focus is on "Näytä lisää"
  press(/^Näytä vähemmän/);
  expect(screen.getAllByRole("listitem")).toHaveLength(2);
  expect(screen.queryByRole("button", { name: "Näytä vähemmän" })).toBeNull();
  expect(document.activeElement).toBe(screen.getByRole("button", { name: /^Näytä \d+ lisää$/ }));
  expect(onListButton()).toBe(true);
  expect(live.textContent).toMatch(/2 \/ 5/);
});
