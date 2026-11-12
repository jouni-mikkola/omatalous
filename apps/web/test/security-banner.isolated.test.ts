/** The banner of a damaged database leads to the tab of Asetukset that has the sign-in and the security log. */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const notices = [{ id: "n1", kind: "db_damaged", at: null, text: "Tietokanta on vioittunut." }];
vi.mock("../src/hooks.ts", async (orig) => ({
  ...(await orig<typeof import("../src/hooks.ts")>()),
  useApi: () => ({ data: { notices }, error: null, loading: false, reload: () => {} }),
}));
vi.mock("../src/components/StaleAnswer.tsx", () => ({ StaleAnswer: () => null }));

const { SecurityNotices } = await import("../src/components/SecurityNotices.tsx");

describe("the banner of the server's notice", () => {
  it("links to Asetukset > Turvallisuus", () => {
    const html = renderToStaticMarkup(createElement(SecurityNotices));
    expect(html).toContain("Tietokanta on vioittunut.");
    expect(html).toContain('<a href="#/settings/security">Turvallisuus</a>');
  });
});
