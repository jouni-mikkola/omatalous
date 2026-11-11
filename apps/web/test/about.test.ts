import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AboutFoot } from "../src/components/AboutFoot.tsx";

const render = (supportUrl?: string) => renderToStaticMarkup(createElement(AboutFoot, { version: "1.2.3", ...(supportUrl === undefined ? {} : { supportUrl }) }));

describe("the footer's line about the app", () => {
  it("shows the version, the attribution the licence keeps, the source address and the licence", () => {
    const out = render("");
    expect(out).toContain("<span>1.2.3</span>");
    expect(out).toMatch(/Omatalous,\s*<a href="https:\/\/www\.linkedin\.com\/in\/jouni-mikkola" target="_blank" rel="noopener noreferrer">Jouni Mikkola<\/a>/);
    expect(out).toMatch(/<a href="https:\/\/github\.com\/jouni-mikkola\/omatalous" target="_blank" rel="noopener noreferrer">Lähdekoodi<\/a>/);
    expect(out).toContain("AGPL-3.0");
  });

  it("links to the troubleshooting guide of the repository, opened like the source link", () => {
    expect(render("")).toMatch(
      /<a href="https:\/\/github\.com\/jouni-mikkola\/omatalous\/blob\/main\/docs\/TROUBLESHOOTING\.md" target="_blank" rel="noopener noreferrer">Ohjeet<\/a>/,
    );
  });

  it("has no support link while the support address is empty", () => {
    expect(render("")).not.toContain("Tue kehitystä");
  });

  it("links to the address of the constants when none is passed, and to the one given otherwise", () => {
    expect(render()).toMatch(/<a href="https:\/\/buymeacoffee\.com\/jouni\.mikkola" target="_blank" rel="noopener noreferrer">Tue kehitystä<\/a>/);
    expect(render("https://example.org/support")).toContain('href="https://example.org/support"');
  });
});
