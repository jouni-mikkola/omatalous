/**
 * A copied value reaches by keys: Enter and Space copy like a click, the title is in the language, and a failed
 * copy says nothing of "copied".
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLanguage } from "../src/format.ts";

const copyText = vi.fn<(text: string) => Promise<boolean>>();
vi.mock("../src/clipboard.ts", () => ({ copyText: (text: string) => copyText(text) }));

const { CopyValue, Copyable } = await import("../src/pages/settings/CopyValue.tsx");

beforeEach(() => {
  setLanguage("en");
  copyText.mockReset();
  copyText.mockResolvedValue(true);
});
afterEach(() => {
  cleanup();
  setLanguage("fi");
});

describe("Copyable", () => {
  it("is a button with an English title that Enter and Space press, and says copied after", async () => {
    render(createElement(Copyable, { value: "abc" }));
    const el = screen.getByRole("button", { name: "abc" });
    expect(el.tabIndex).toBe(0);
    expect(el.getAttribute("title")).toBe("Copy");
    fireEvent.keyDown(el, { key: "Enter" });
    await waitFor(() => expect(el.getAttribute("title")).toBe("Copied"));
    expect(copyText).toHaveBeenCalledWith("abc");
    fireEvent.keyDown(el, { key: " " });
    await waitFor(() => expect(copyText).toHaveBeenCalledTimes(2));
    fireEvent.keyDown(el, { key: "a" });
    expect(copyText).toHaveBeenCalledTimes(2);
  });

  it("shows no copied when the copy fails", async () => {
    copyText.mockResolvedValue(false);
    render(createElement(Copyable, { value: "abc" }));
    const el = screen.getByRole("button", { name: "abc" });
    fireEvent.click(el);
    await waitFor(() => expect(copyText).toHaveBeenCalledTimes(1));
    await Promise.resolve();
    expect(el.getAttribute("title")).toBe("Copy");
  });
});

describe("CopyValue", () => {
  it("gives the value the keys and the English title", async () => {
    render(createElement(CopyValue, { value: "xyz", label: "Redirect URL" }));
    const el = screen.getByRole("button", { name: "xyz" });
    expect(el.tabIndex).toBe(0);
    expect(el.getAttribute("title")).toBe("Copy");
    fireEvent.keyDown(el, { key: "Enter" });
    await waitFor(() => expect(copyText).toHaveBeenCalledWith("xyz"));
  });
});
