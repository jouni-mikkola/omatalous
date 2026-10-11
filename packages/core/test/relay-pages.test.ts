/**
 * The privacy and terms pages on the relay site (relay/privacy, relay/terms): the addresses Omatalous tells the owner to
 * type into Enable Banking's registration form. The return page has its own test in local-origin.test.ts.
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const RELAY = new URL("../../../relay/", import.meta.url);
const WORKFLOW = readFileSync(new URL("../../../.github/workflows/pages.yml", import.meta.url), "utf8");
const folders = readdirSync(RELAY, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort();
const page = (name: string) => readFileSync(new URL(`${name}/index.html`, RELAY), "utf8");

/** The text of the section in one language, tags removed. */
function section(html: string, lang: "fi" | "en"): string {
  const m = new RegExp(`<section lang="${lang}">([\\s\\S]*?)</section>`).exec(html);
  expect(m, `a ${lang} section`).not.toBeNull();
  return m![1]!.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

describe("relay site", () => {
  it("has the return page and the two pages the registration form asks for", () => {
    expect(folders).toEqual(["callback", "privacy", "terms"]);
  });

  it("the workflow checks every page before it publishes", () => {
    const listed = /for page in ([a-z ]+); do test -f "relay\/\$page\/index\.html"/.exec(WORKFLOW)?.[1]?.split(" ").sort();
    expect(listed).toEqual(folders);
    expect(WORKFLOW).toContain("for f in relay/*/index.html");
  });

  for (const name of ["privacy", "terms"]) {
    describe(`${name} page`, () => {
      const html = page(name);

      it("carries a CSP that names exactly its own style and allows no script", () => {
        const style = /<style>([\s\S]*?)<\/style>/.exec(html)![1]!;
        const csp = /Content-Security-Policy" content="([^"]*)"/.exec(html)![1]!;
        expect(csp).toContain(`style-src 'sha256-${createHash("sha256").update(style).digest("base64")}';`);
        expect(csp).toContain("default-src 'none'");
        expect(csp).not.toMatch(/script-src|unsafe-|https?:|\*/);
        expect(html).toContain('<meta name="referrer" content="no-referrer">');
      });

      it("loads nothing and links nowhere outside", () => {
        // the workflow greps for the same things before it publishes
        expect(html).not.toMatch(/<script|<link|<img|<iframe|<form|<a |@import|[^A-Za-z]url\(|https?:\/\//i);
      });

      it("is Finnish first with the English text below, and says it sets no cookies", () => {
        expect(html.indexOf('<section lang="fi">')).toBeGreaterThan(0);
        expect(html.indexOf('<section lang="en">')).toBeGreaterThan(html.indexOf('<section lang="fi">'));
        expect(section(html, "fi")).toContain("ei aseta evästeitä");
        expect(section(html, "en")).toContain("sets no cookies");
      });
    });
  }

  it("the privacy page says where the data goes and who answers questions", () => {
    const html = page("privacy");
    const fi = section(html, "fi");
    const en = section(html, "en");
    expect(fi).toContain("omalla koneella");
    expect(fi).toContain("Enable Bankingin kautta vain tälle koneelle");
    expect(fi).toContain("kehittäjä ei saa taloudelta mitään tietoja");
    expect(fi).toContain("ylläpitäjälle");
    expect(en).toContain("own machine");
    expect(en).toContain("through Enable Banking to that machine only");
    expect(en).toContain("developer of the app receives no data");
    expect(en).toContain("household's admin");
    // the return hop is named too: GitHub Pages sees the request, as docs/SECURITY.md says
    expect(fi).toContain("Paluusivua palvelee GitHub Pages");
    expect(fi).toContain("kertakäyttöisen koodin");
    expect(fi).toContain("IP-osoitteen");
    expect(en).toContain("The return page is served by GitHub Pages");
    expect(en).toContain("the one-time code");
    expect(en).toContain("IP address");
    // the one outside lookup is named, with what it never sends
    expect(fi).toContain("YTJ");
    expect(en).toContain("Amounts, dates, account numbers and names of people are not sent");
  });
});
