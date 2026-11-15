/**
 * The bar over Tapahtumat: the search and the period first, one Suodata button whose lists the keyboard walks, and a
 * named chip with an x for each limit that is set.
 */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setLanguage } from "../src/format.ts";
import type { Filters } from "../src/pages/transactions/FilterChips.tsx";
import { TxBar } from "../src/pages/transactions/TxBar.tsx";
import { t } from "../src/text.ts";

afterEach(() => {
  cleanup();
  setLanguage("fi");
});

const empty: Filters = { q: "", chip: "", category: "", kind: "", accountId: "", merchant: "", from: "", to: "" };
const marks = [
  { key: "manual", label: "Käsin luokitellut" },
  { key: "pending", label: "Varaukset" },
];

function bar(filters: Filters = empty) {
  const set = vi.fn();
  const clear = vi.fn();
  const onSearch = vi.fn();
  render(
    createElement(TxBar, {
      filters,
      categories: [],
      accounts: [
        { id: "a1", name: "Käyttötili" },
        { id: "a2", name: "Säästötili" },
      ],
      severalAccounts: true,
      looks: new Map(),
      marks,
      today: "2026-10-25",
      set,
      clear,
      onSearch,
    }),
  );
  return { set, clear, onSearch };
}

function openFilter() {
  const view = bar();
  fireEvent.click(screen.getByRole("button", { name: t("fchip.filter") }));
  return { ...view, limits: within(screen.getByRole("listbox", { name: t("fchip.limits") })), accounts: within(screen.getByRole("listbox", { name: t("fchip.account") })) };
}

describe("Suodata by keyboard", () => {
  it("lists the income limit and the marks, then the accounts", () => {
    const { limits, accounts } = openFilter();
    expect(limits.getAllByRole("option")).toHaveLength(3);
    expect(accounts.getAllByRole("option")).toHaveLength(2);
  });

  it("steps with the arrows and jumps with Home and End", () => {
    const { limits } = openFilter();
    const options = limits.getAllByRole("option");
    options[0]!.focus();
    const press = (key: string) => fireEvent.keyDown(document.activeElement!, { key });
    press("ArrowDown");
    expect(document.activeElement).toBe(options[1]);
    press("End");
    expect(document.activeElement).toBe(options[2]);
    press("ArrowUp");
    expect(document.activeElement).toBe(options[1]);
    press("Home");
    expect(document.activeElement).toBe(options[0]);
  });

  it("sets the account on Enter", () => {
    const { set, accounts } = openFilter();
    const options = accounts.getAllByRole("option");
    options[0]!.focus();
    fireEvent.keyDown(options[0]!, { key: "Enter" });
    expect(set).toHaveBeenCalledWith({ accountId: "a1" });
  });

  it("sets the account on a click", () => {
    const { set, accounts } = openFilter();
    fireEvent.click(accounts.getAllByRole("option")[1]!);
    expect(set).toHaveBeenCalledWith({ accountId: "a2" });
  });

  it("sets a mark of the rows by the limit list", () => {
    const { set, limits } = openFilter();
    fireEvent.click(limits.getByRole("option", { name: "Käsin luokitellut" }));
    expect(set).toHaveBeenCalledWith({ chip: "manual" });
  });
});

describe("the limits that are set", () => {
  it("shows no chips while nothing is limited", () => {
    bar();
    expect(screen.queryByRole("group", { name: t("fchip.limits") })).toBeNull();
  });

  it("names each limit with an x that lets it go, and one button that lets all go", () => {
    const { set, clear } = bar({ ...empty, accountId: "a1", chip: "pending" });
    const chips = within(screen.getByRole("group", { name: t("fchip.limits") }));
    expect(chips.getByText("Varaukset")).toBeTruthy();
    fireEvent.click(chips.getByRole("button", { name: t("fchip.remove", { name: t("fchip.account") }) }));
    expect(set).toHaveBeenCalledWith({ accountId: "" });
    fireEvent.click(chips.getByRole("button", { name: t("tx.clear") }));
    expect(clear).toHaveBeenCalled();
  });
});

describe("the search box", () => {
  it("settles what is typed on Enter", () => {
    const { onSearch } = bar();
    fireEvent.change(screen.getByRole("searchbox", { name: t("tx.search") }), { target: { value: " kahvi " } });
    fireEvent.submit(screen.getByRole("search"));
    expect(onSearch).toHaveBeenCalledWith("kahvi", true);
  });

  it("is emptied by its clear button", () => {
    const { onSearch } = bar({ ...empty, q: "kahvi" });
    fireEvent.click(screen.getByRole("button", { name: t("fchip.search_clear") }));
    expect(onSearch).toHaveBeenCalledWith("", true);
  });
});
