/** The category list follows the keyboard: the active option is scrolled into the box, and the list starts at the set value. */
import { fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import "./dom-kit.ts";
import { CategoryMenu } from "../src/pages/transactions/CategoryChip.tsx";

const CATS = Array.from({ length: 30 }, (_, i) => ({ id: `c${i}`, label: `Kategoria ${i}`, group: `Ryhmä ${Math.floor(i / 10)}` }));
const scroll = vi.fn();
const original = Element.prototype.scrollIntoView;

beforeEach(() => {
  scroll.mockReset();
  Element.prototype.scrollIntoView = function (this: Element, ...a: unknown[]) {
    scroll.apply(this, a);
  };
});
afterEach(() => {
  Element.prototype.scrollIntoView = original;
});

const open = (value = "", onPick: (id: string) => void = () => {}) => render(createElement(CategoryMenu, { categories: CATS as never, value, onPick }));

it("scrolls the 16th option into view, nearest, after 15 presses of ArrowDown", () => {
  open();
  const search = screen.getByRole("combobox");
  for (let i = 0; i < 15; i++) fireEvent.keyDown(search, { key: "ArrowDown" });
  const last = scroll.mock.instances.at(-1) as HTMLElement;
  expect(last.id).toBe("tx-cat-c15");
  expect(scroll.mock.calls.at(-1)).toEqual([{ block: "nearest" }]);
});

it("starts on the option of the set value, and Enter picks the active option", () => {
  const picked: string[] = [];
  open("c20", (id) => picked.push(id));
  const search = screen.getByRole("combobox");
  expect(search.getAttribute("aria-activedescendant")).toBe("tx-cat-c20");
  fireEvent.keyDown(search, { key: "ArrowDown" });
  fireEvent.keyDown(search, { key: "Enter" });
  expect(picked).toEqual(["c21"]);
});

it("narrows the list by the search", () => {
  open();
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "Kategoria 29" } });
  expect(screen.getAllByRole("option")).toHaveLength(1);
});
