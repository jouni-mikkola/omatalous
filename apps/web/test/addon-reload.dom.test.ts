/**
 * The add-on module and a page served before the sign-in (docs/MODULES.md): the signed-in answer names the module, the
 * page reloads once to load it, and a module that still fails to load ends in one notice, not in a loop.
 */
import { render, screen, waitFor } from "@testing-library/react";
import { createElement as h } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/App.tsx";
import { addOnLoadFailed, markAddOnFailed, reloadForAddOn, WEB_EXTENSIONS } from "../src/extensions.ts";
import { stubApi } from "./dom-kit.ts";

const user = { id: 1, username: "maija", displayName: "Maija", role: "admin", mustChangePassword: false };

beforeEach(() => sessionStorage.clear());
afterEach(() => {
  WEB_EXTENSIONS.splice(0);
  markAddOnFailed(false);
  sessionStorage.clear();
});

describe("reloadForAddOn", () => {
  it("reloads once, then marks the failed load and does not reload again", () => {
    const reload = vi.fn();
    expect(reloadForAddOn({ addOn: true }, reload)).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(addOnLoadFailed()).toBe(false);
    for (let i = 0; i < 3; i++) expect(reloadForAddOn({ addOn: true }, reload)).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(addOnLoadFailed()).toBe(true);
  });

  it("does nothing for an answer with no module, or for a page that has it", () => {
    const reload = vi.fn();
    expect(reloadForAddOn({}, reload)).toBe(false);
    WEB_EXTENSIONS.push({ id: "example" });
    expect(reloadForAddOn({ addOn: true }, reload)).toBe(false);
    expect(reload).not.toHaveBeenCalled();
    expect(addOnLoadFailed()).toBe(false);
  });

  it("forgets the mark once the page has its module, so a later sign-in can reload again", () => {
    const reload = vi.fn();
    reloadForAddOn({ addOn: true }, reload);
    WEB_EXTENSIONS.push({ id: "example" });
    reloadForAddOn({ addOn: true }, reload);
    WEB_EXTENSIONS.splice(0);
    expect(reloadForAddOn({ addOn: true }, reload)).toBe(true);
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it("shows no warning for a loaded module when the storage cannot forget the mark", () => {
    const reload = vi.fn();
    WEB_EXTENSIONS.push({ id: "example" });
    vi.stubGlobal("sessionStorage", {
      removeItem: () => {
        throw new Error("no storage");
      },
    });
    try {
      expect(reloadForAddOn({ addOn: true }, reload)).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
    expect(reload).not.toHaveBeenCalled();
    expect(addOnLoadFailed()).toBe(false);
  });

  it("does not reload where the session storage cannot count", () => {
    const reload = vi.fn();
    vi.stubGlobal("sessionStorage", {
      getItem: () => {
        throw new Error("no storage");
      },
    });
    try {
      expect(reloadForAddOn({ addOn: true }, reload)).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
    expect(reload).not.toHaveBeenCalled();
    expect(addOnLoadFailed()).toBe(true);
  });
});

describe("App: a page served signed out that another tab signed in", () => {
  const reload = vi.fn();
  beforeEach(() => {
    reload.mockClear();
    vi.stubGlobal("location", { ...window.location, reload });
  });

  it("loads the module when the state answer returns a user and names it", async () => {
    stubApi({ "GET /api/auth/state": { needsSetup: false, user, timezone: "Europe/Helsinki", addOn: true } });
    render(h(App));
    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
  });

  it("does not reload a second time when the module is still missing, and says so once", async () => {
    sessionStorage.setItem("omatalous-addon-reload", "1");
    // a member who must change the password sees the form at once, with nothing else to load
    stubApi({ "GET /api/auth/state": { needsSetup: false, user: { ...user, mustChangePassword: true }, timezone: "Europe/Helsinki", addOn: true } });
    render(h(App));
    await screen.findByRole("heading", { name: /salasana/i });
    expect(reload).not.toHaveBeenCalled();
    expect(addOnLoadFailed()).toBe(true);
  });

  it("leaves a signed-out answer alone", async () => {
    stubApi({ "GET /api/auth/state": { needsSetup: false, user: null, timezone: "Europe/Helsinki" } });
    render(h(App));
    await screen.findByLabelText("Käyttäjätunnus");
    expect(reload).not.toHaveBeenCalled();
  });
});
