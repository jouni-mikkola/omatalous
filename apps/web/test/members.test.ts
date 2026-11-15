import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { Members, memberInstructions, SecretBox } from "../src/pages/settings/Members.tsx";

const ADDRESS = "http://192.168.1.50:8080";

describe("memberInstructions", () => {
  it("gives the address, the username, the temporary password and that it must change at the first login", () => {
    const lines = memberInstructions(ADDRESS, "anna", "k3f9-2mxq").split("\n");
    expect(lines).toEqual([
      "Omatalous: http://192.168.1.50:8080",
      "Käyttäjätunnus: anna",
      "Väliaikainen salasana: k3f9-2mxq",
      "Jäsenen pitää vaihtaa salasana ensimmäisellä kirjautumiskerralla.",
    ]);
  });
});

describe("the new member's password box", () => {
  const box = (who: string, password: string) => renderToStaticMarkup(createElement(SecretBox, { who, password, address: ADDRESS }));

  it("shows the password once and offers Kopioi ohje", () => {
    const html = box("anna", "k3f9-2mxq");
    expect(html).toContain("<code>k3f9-2mxq</code>");
    expect(html).toContain("Näet tämän vain kerran.");
    expect(html).toContain(">Kopioi ohje</button>");
  });

  it("escapes a username the way the page does", () => {
    expect(box("a<b", "x")).not.toContain("a<b");
  });
});

describe("the form for a new member", () => {
  it("is closed behind one Lisää jäsen button until it is asked for", () => {
    const user = { id: "u1", username: "admin", displayName: "Admin", role: "admin" } as never;
    vi.stubGlobal("window", { location: { origin: ADDRESS } });
    const html = renderToStaticMarkup(createElement(Members, { me: user, meta: { accounts: [] } as never, onChange: () => {} }));
    vi.unstubAllGlobals();
    expect(html).toContain(">Lisää jäsen</button>");
    // the section's one action stands in the strip of its name, right of the heading
    expect(html).toMatch(/<div class="card-head"><h2[^>]*>Talouden jäsenet<\/h2><div class="form-row flush"><button[^>]*>Lisää jäsen<\/button><\/div><\/div>/);
    expect(html).not.toContain("<form");
  });
});
