/**
 * The browser side of the add-on module (docs/MODULES.md): a failed load marks itself for the shell's one notice, and the
 * reload after a sign-in follows the sign-in answer, not a tag in the page. The module here is never fetched; the import
 * of a made-up address fails.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { addOnAwaitsSignIn, addOnLoadFailed, markAddOnFailed, WEB_EXTENSIONS } from "../src/extensions.ts";
import { loadWebModule } from "../src/module-host.ts";
import { message } from "@banking/core";

afterEach(() => {
  WEB_EXTENSIONS.splice(0);
  markAddOnFailed(false);
  vi.restoreAllMocks();
});

describe("loadWebModule", () => {
  it("marks a failed import once and leaves the app without the module", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(addOnLoadFailed()).toBe(false);
    await loadWebModule("/modules/example/1.2.0/");
    expect(addOnLoadFailed()).toBe(true);
    expect(WEB_EXTENSIONS).toEqual([]);
    expect(logged).toHaveBeenCalledTimes(1);
  });

  it("marks a base the server could not have written", async () => {
    await loadWebModule("https://elsewhere.example/web/");
    expect(addOnLoadFailed()).toBe(true);
  });
});

describe("addOnAwaitsSignIn", () => {
  it("reloads only for a sign-in answer that names a module while the page has none", () => {
    expect(addOnAwaitsSignIn({ addOn: true })).toBe(true);
    expect(addOnAwaitsSignIn({})).toBe(false);
    expect(addOnAwaitsSignIn({ addOn: false })).toBe(false);
  });

  it("does not reload when the page already has its module", () => {
    WEB_EXTENSIONS.push({ id: "example" });
    expect(addOnAwaitsSignIn({ addOn: true })).toBe(false);
  });
});

describe("the notice of a failed load", () => {
  it("has a text", () => {
    expect(message("shell.addon_failed")).toMatch(/Lisäosa ei latautunut/);
  });
});
