/**
 * The row of tabs: it never wraps, a fade marks the end that has more tabs out of sight, and the open tab is brought
 * into sight when the row is drawn and when the open tab changes. The widths are stubbed, since a DOM has no layout.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import "./dom-kit.ts";
import { hiddenEdges, scrollToShow, Tabs } from "../src/components/ui/Tabs.tsx";
import { rules } from "./css-kit.ts";

const VIEW = 300;
const ROW = 800;
/** Four tabs of 100 px side by side from 0 to 400, then a gap to the end of a row that is wider than they are. */
const LEFT: Record<string, number> = { a: 0, b: 100, c: 200, d: 700 };

const undo: (() => void)[] = [];
const scrolled = new WeakMap<object, number>();

/** Gives the elements of the test the widths a browser would: the row is `VIEW` wide on `ROW` of content. */
function stubLayout() {
  const stub = (name: string, get: (el: HTMLElement) => number, set?: (el: HTMLElement, v: number) => void) => {
    const old = Object.getOwnPropertyDescriptor(HTMLElement.prototype, name);
    Object.defineProperty(HTMLElement.prototype, name, {
      configurable: true,
      get(this: HTMLElement) {
        return get(this);
      },
      set(this: HTMLElement, v: number) {
        set?.(this, v);
      },
    });
    undo.push(() => (old ? Object.defineProperty(HTMLElement.prototype, name, old) : Reflect.deleteProperty(HTMLElement.prototype, name)));
  };
  stub("clientWidth", (el) => (el.classList.contains("tabs") ? VIEW : 0));
  stub("scrollWidth", (el) => (el.classList.contains("tabs") ? ROW : 0));
  stub("offsetLeft", (el) => LEFT[el.dataset.tab ?? ""] ?? 0);
  stub("offsetWidth", (el) => (el.dataset.tab ? 100 : 0));
  stub("scrollLeft", (el) => scrolled.get(el) ?? 0, (el, v) => void scrolled.set(el, v));
}

afterEach(() => {
  while (undo.length) undo.pop()!();
});

const row = (open: string) =>
  createElement(
    Tabs,
    { label: "Esimerkki" },
    ...Object.keys(LEFT).map((id) => createElement("a", { key: id, href: `#/${id}`, "data-tab": id, "aria-current": id === open ? "page" : undefined }, id)),
  );
const nav = () => screen.getByRole("navigation", { name: "Esimerkki" });

describe("the pure parts of the row", () => {
  it("marks the end that has tabs out of sight", () => {
    expect(hiddenEdges(0, 300, 800)).toEqual({ start: false, end: true });
    expect(hiddenEdges(250, 300, 800)).toEqual({ start: true, end: true });
    expect(hiddenEdges(500, 300, 800)).toEqual({ start: true, end: false });
    expect(hiddenEdges(0, 300, 300)).toEqual({ start: false, end: false });
    // half a pixel of rounding is no hidden tab
    expect(hiddenEdges(0.5, 300, 300.5)).toEqual({ start: false, end: false });
  });

  it("leaves a tab that is whole in sight where it is and puts one out of sight in the middle", () => {
    expect(scrollToShow(0, 300, 100, 100)).toBe(0);
    expect(scrollToShow(0, 300, 700, 100)).toBe(600);
    expect(scrollToShow(400, 300, 0, 100)).toBe(0);
    // a tab cut at the edge counts as out of sight
    expect(scrollToShow(0, 300, 250, 100)).toBe(150);
  });
});

describe("Tabs", () => {
  it("brings the open tab into sight and fades the start, since more lies before it", async () => {
    stubLayout();
    render(row("d"));
    await waitFor(() => expect(nav().hasAttribute("data-fade-start")).toBe(true));
    // 700 - (300 - 100) / 2
    expect(scrolled.get(nav())).toBe(600);
    expect(nav().hasAttribute("data-fade-end")).toBe(false);
  });

  it("fades the end only while the first tab is the open one", () => {
    stubLayout();
    render(row("a"));
    expect(nav().hasAttribute("data-fade-start")).toBe(false);
    expect(nav().hasAttribute("data-fade-end")).toBe(true);
  });

  it("follows the scroll with the fade at both ends", () => {
    stubLayout();
    render(row("a"));
    scrolled.set(nav(), 250);
    fireEvent.scroll(nav());
    expect(nav().hasAttribute("data-fade-start")).toBe(true);
    expect(nav().hasAttribute("data-fade-end")).toBe(true);
  });

  it("scrolls to the tab that becomes the open one", async () => {
    stubLayout();
    const view = render(row("a"));
    expect(scrolled.get(nav()) ?? 0).toBe(0);
    view.rerender(row("d"));
    await waitFor(() => expect(scrolled.get(nav())).toBe(600));
  });

  it("names the row for a screen reader and holds the links as they are given", () => {
    render(row("b"));
    expect([...nav().querySelectorAll("a")].map((a) => a.textContent)).toEqual(["a", "b", "c", "d"]);
    expect(nav().querySelector("[aria-current]")?.textContent).toBe("b");
  });
});

describe("the style of the row", () => {
  const css = readFileSync(new URL("../src/styles/base.css", import.meta.url), "utf8");
  const body = (selector: string) => rules(css).find((r) => r.selector === selector)?.body ?? "";

  it("never wraps and scrolls sideways where the tabs do not fit", () => {
    expect(body(".tabs")).toMatch(/overflow-x: auto/);
    expect(body(".tabs")).not.toMatch(/flex-wrap/);
  });

  it("keeps every tab a finger wide and tall, nothing under 40 px for a mouse", () => {
    const tab = body(".tabs button, .tabs a");
    expect(Number(/min-height: (\d+)px/.exec(tab)?.[1])).toBeGreaterThanOrEqual(44);
    expect(tab).toMatch(/flex: none/);
  });

  it("fades with a mask that the marks of the row switch on", () => {
    expect(body(".tabs:is([data-fade-start], [data-fade-end])")).toMatch(/mask-image: linear-gradient/);
  });
});
