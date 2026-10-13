/** The split of a sum into whole part, decimals and unit, and the head of a panel with and without a datum. */
import { type ComponentProps, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Figure } from "../src/components/Figure.tsx";
import { Section } from "../src/components/Section.tsx";
import { money, percent } from "../src/format.ts";

const render = (text: string, size: "s" | "m" | "l" = "m") => renderToStaticMarkup(createElement(Figure, { text, size }));

describe("Figure", () => {
  it("splits money out into whole part, decimals and unit without changing a character", () => {
    const html = render(money(38_282_89));
    expect(html).toBe(`<span class="fig fig-m"><span class="fig-int">38 282</span><span class="fig-dec">,89</span><span class="fig-unit"> €</span></span>`);
  });
  it("keeps the true minus of money out and the plus of a change in the whole part", () => {
    expect(render(money(-12_00, false))).toContain(`<span class="fig-int">−12</span>`);
    expect(render("+120 €")).toContain(`<span class="fig-int">+120</span>`);
  });
  it("splits a sum without decimals, a per-month unit and a percent", () => {
    expect(render(money(246_00, false), "s")).toBe(`<span class="fig fig-s"><span class="fig-int">246</span><span class="fig-unit"> €</span></span>`);
    expect(render("246 €/kk")).toContain(`<span class="fig-unit"> €/kk</span>`);
    expect(render(percent(0.19))).toBe(`<span class="fig fig-m"><span class="fig-int">19</span><span class="fig-unit"> %</span></span>`);
  });
  it("keeps a number that is no money whole when asked, and splits money as before", () => {
    const whole = (text: string) => renderToStaticMarkup(createElement(Figure, { text, size: "m", whole: true }));
    expect(whole("7,7 kuukautta")).toBe(`<span class="fig fig-m"><span class="fig-int">7,7</span><span class="fig-unit"> kuukautta</span></span>`);
    expect(whole("12 %")).toContain(`<span class="fig-int">12</span>`);
    expect(render("7,7 kuukautta")).toContain(`<span class="fig-dec">,7</span>`);
  });
  it("passes a dash for a missing value through whole", () => {
    expect(render("–")).toBe(`<span class="fig fig-m">–</span>`);
  });
});

describe("Section head", () => {
  const head = (props: Partial<ComponentProps<typeof Section>>) => renderToStaticMarkup(createElement(Section, { id: "x", title: "Tilit", children: createElement("p", null, "body"), ...props }));
  it("draws only the name cell for a section with no datum and no actions", () => {
    const html = head({});
    expect(html).toContain(`<div class="card-head tb"><div class="card-name"><h2 id="x-h">Tilit</h2></div></div>`);
    expect(html).not.toContain("card-datum");
    expect(html).not.toContain("card-tool");
  });
  it("keeps the line under the name inside the name cell and the actions in the tool cell", () => {
    const html = head({ sub: "alarivi", actions: createElement("button", null, "Lisää") });
    expect(html).toContain(`<div class="card-sub">alarivi</div></div><div class="card-tool">`);
    expect(html).toContain("<button>Lisää</button>");
  });
  it("draws the datum cell only for a datum that is there", () => {
    expect(head({ datum: "13.10.–22.10." })).toContain(`<div class="card-datum">13.10.–22.10.</div>`);
    expect(head({ datum: "" })).not.toContain("card-datum");
    expect(head({ datum: null })).not.toContain("card-datum");
  });
});

describe("Figure key", () => {
  it("is a new element when the text changes, so its fade fires", () => {
    const key = (text: string) => (Figure({ text, size: "m" }) as { key: string | null }).key;
    expect(key("12,50 €")).toBe("12,50 €");
    expect(key("12,50 €")).not.toBe(key("13,50 €"));
    expect(key("–")).toBe("–");
  });
});
