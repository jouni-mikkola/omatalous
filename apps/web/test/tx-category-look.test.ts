import { CATEGORIES } from "@banking/core";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CATEGORY_ICON, CategoryIcon, slotOf } from "../src/pages/transactions/category-look.tsx";

describe("the category look of Tapahtumat", () => {
  it("has an icon of its own for every category of the catalogue, none shared inside a group, and no stray one", () => {
    expect(CATEGORIES.filter((c) => !CATEGORY_ICON[c.id]).map((c) => c.id)).toEqual([]);
    const ids = new Set(CATEGORIES.map((c) => c.id));
    expect(Object.keys(CATEGORY_ICON).filter((id) => !ids.has(id))).toEqual([]);
    const groups = new Map<string, string[]>();
    for (const c of CATEGORIES) groups.set(c.group, [...(groups.get(c.group) ?? []), CATEGORY_ICON[c.id]!]);
    for (const [group, icons] of groups) expect(new Set(icons).size, group).toBe(icons.length);
  });

  it("draws a group's icon for a category it does not know, and gives the eighth group on the rest hue", () => {
    const html = renderToStaticMarkup(createElement(CategoryIcon, { category: { id: "unknown", group: "Ruoka" } }));
    expect(html).toContain(CATEGORY_ICON.groceries);
    expect(slotOf({ group: "Asuminen" })).toBe(1);
    expect(slotOf({ group: "Tulot" })).toBe("rest");
  });
});
