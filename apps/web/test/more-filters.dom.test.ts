/**
 * The list of the "more" chip is reached by the keyboard: the arrows step through the options, Home and End go to the
 * first and last, and Enter on an account sets that account as the filter.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setLanguage } from "../src/format.ts";
import { type Filters, FilterChips } from "../src/pages/transactions/FilterChips.tsx";
import { t } from "../src/text.ts";

afterEach(() => {
  cleanup();
  setLanguage("fi");
});

const empty: Filters = { q: "", chip: "", category: "", kind: "", accountId: "", merchant: "", from: "", to: "" };

function open() {
  const set = vi.fn();
  render(
    createElement(FilterChips, {
      filters: empty,
      categories: [],
      accounts: [
        { id: "a1", name: "Käyttötili" },
        { id: "a2", name: "Säästötili" },
      ],
      severalAccounts: true,
      looks: new Map(),
      today: "2026-10-25",
      set,
      clear: () => undefined,
    }),
  );
  fireEvent.click(screen.getByRole("button", { name: new RegExp(t("fchip.more")) }));
  const options = screen.getAllByRole("option");
  const list = screen.getByRole("listbox");
  return { set, options, press: (key: string) => fireEvent.keyDown(document.activeElement ?? list, { key }) };
}

describe("the more chip by keyboard", () => {
  it("shows the income option and the accounts, and focuses the first", () => {
    const { options } = open();
    expect(options).toHaveLength(3);
    expect(document.activeElement).toBe(options[0]);
  });

  it("steps with the arrows and jumps with Home and End", () => {
    const { options, press } = open();
    press("ArrowDown");
    expect(document.activeElement).toBe(options[1]);
    press("ArrowDown");
    expect(document.activeElement).toBe(options[2]);
    press("ArrowUp");
    expect(document.activeElement).toBe(options[1]);
    press("ArrowUp");
    expect(document.activeElement).toBe(options[0]);
    press("End");
    expect(document.activeElement).toBe(options[2]);
    press("Home");
    expect(document.activeElement).toBe(options[0]);
  });

  it("sets the account on Enter", () => {
    const { set, press } = open();
    press("ArrowDown");
    press("Enter");
    expect(set).toHaveBeenCalledWith({ accountId: "a1" });
  });

  it("still sets the account on a click", () => {
    const { set, options } = open();
    fireEvent.click(options[2]!);
    expect(set).toHaveBeenCalledWith({ accountId: "a2" });
  });
});
