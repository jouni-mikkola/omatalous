import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AboutFoot } from "../src/components/AboutFoot.tsx";
import { AboutApp } from "../src/pages/settings/AboutApp.tsx";

const foot = () => renderToStaticMarkup(createElement(AboutFoot, { version: "1.2.3" }));

describe("the footer's line about the app", () => {
  it("shows the version, the attribution the licence keeps, the source address and the licence", () => {
    const out = foot();
    expect(out).toContain("<span>1.2.3</span>");
    expect(out).toMatch(/<span>Omatalous,\s*Jouni Mikkola<\/span>/);
    expect(out).toMatch(/<a href="https:\/\/github\.com\/jouni-mikkola\/omatalous" target="_blank" rel="noopener noreferrer">Lähdekoodi<\/a>/);
    expect(out).toContain("AGPL-3.0");
  });

  it("links to the troubleshooting guide of the repository, opened like the source link", () => {
    expect(foot()).toMatch(
      /<a href="https:\/\/github\.com\/jouni-mikkola\/omatalous\/blob\/main\/docs\/TROUBLESHOOTING\.md" target="_blank" rel="noopener noreferrer">Ohjeet<\/a>/,
    );
  });

  it("holds no link to the author's page or to a donation page", () => {
    const out = foot();
    expect(out).not.toContain("linkedin");
    expect(out).not.toContain("buymeacoffee");
    expect(out).not.toContain("Tue kehitystä");
  });
});

describe("Asetukset > Palvelin ja ylläpito: the software information", () => {
  it("has the author's page and the link to support the development, opened like the source link", () => {
    const out = renderToStaticMarkup(createElement(AboutApp));
    expect(out).toMatch(/<a [^>]*href="https:\/\/www\.linkedin\.com\/in\/jouni-mikkola"[^>]*rel="noopener noreferrer"[^>]*>Jouni Mikkola<\/a>/);
    expect(out).toMatch(/<a [^>]*href="https:\/\/buymeacoffee\.com\/jouni\.mikkola"[^>]*rel="noopener noreferrer"[^>]*>Tue kehitystä<\/a>/);
  });
});
