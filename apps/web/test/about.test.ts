import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { About } from "../src/pages/settings/About.tsx";

const render = (supportUrl?: string) => renderToStaticMarkup(createElement(About, { version: "1.2.3", ...(supportUrl === undefined ? {} : { supportUrl }) }));

describe("Tietoja", () => {
  it("shows the version, the author and source links with their addresses, and the licence", () => {
    const out = render("");
    expect(out).toContain("Versio");
    expect(out).toContain("1.2.3");
    expect(out).toMatch(/<a href="https:\/\/www\.linkedin\.com\/in\/jouni-mikkola" target="_blank" rel="noopener noreferrer">Jouni Mikkola<\/a>/);
    expect(out).toMatch(/<a href="https:\/\/github\.com\/jouni-mikkola\/omatalous" target="_blank" rel="noopener noreferrer">GitHub<\/a>/);
    expect(out).toContain("MIT");
  });

  it("has no support sentence and no support link while the support address is empty", () => {
    const out = render("");
    expect(out).not.toContain("tukea kehitystä");
    expect(out).not.toContain("ilmainen");
  });

  it("links to the address of the constants when none is passed", () => {
    expect(render()).toMatch(/<a href="https:\/\/buymeacoffee\.com\/jouni\.mikkola" target="_blank" rel="noopener noreferrer">tukea kehitystä<\/a>\./);
  });

  it("has both when the support address is set, the link inside the one sentence", () => {
    const out = render("https://example.org/support");
    expect(out).toContain("Omatalous on ilmainen. Jos pidät siitä, voit ");
    expect(out).toMatch(/<a href="https:\/\/example\.org\/support" target="_blank" rel="noopener noreferrer">tukea kehitystä<\/a>\./);
  });
});
