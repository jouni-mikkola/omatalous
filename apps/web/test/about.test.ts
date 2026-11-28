import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AboutApp } from "../src/pages/settings/AboutApp.tsx";

describe("Asetukset > Turvallisuus: the software information", () => {
  const out = () => renderToStaticMarkup(createElement(AboutApp, { version: "1.2.3" }));

  it("has the attribution the licence keeps, the licence, the source and the guides, opened like the source link", () => {
    expect(out()).toMatch(/<span>Omatalous,\s*Jouni Mikkola<\/span>/);
    expect(out()).toContain("AGPL-3.0");
    expect(out()).toContain("1.2.3");
    expect(out()).toMatch(/<a [^>]*href="https:\/\/github\.com\/jouni-mikkola\/omatalous"[^>]*rel="noopener noreferrer"[^>]*>Lähdekoodi<\/a>/);
    expect(out()).toMatch(
      /<a [^>]*href="https:\/\/github\.com\/jouni-mikkola\/omatalous\/blob\/main\/docs\/TROUBLESHOOTING\.md"[^>]*rel="noopener noreferrer"[^>]*>Ohjeet<\/a>/,
    );
  });

  it("has the author's page and the link to support the development, opened like the source link", () => {
    expect(out()).toMatch(/<a [^>]*href="https:\/\/www\.linkedin\.com\/in\/jouni-mikkola"[^>]*rel="noopener noreferrer"[^>]*>Jouni Mikkola<\/a>/);
    expect(out()).toMatch(/<a [^>]*href="https:\/\/buymeacoffee\.com\/jouni\.mikkola"[^>]*rel="noopener noreferrer"[^>]*>Tue kehitystä<\/a>/);
  });
});
