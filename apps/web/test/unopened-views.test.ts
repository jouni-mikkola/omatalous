import { describe, expect, it } from "vitest";
import { listed } from "../src/pages/settings/UnopenedViews.tsx";
import { findingView, insightView } from "../src/view-opens.tsx";

describe("unopened views", () => {
  it("names a view without its subject", () => {
    expect(findingView("subscriptions:rise:series:abc")).toBe("finding:subscriptions:rise");
    expect(insightView("price:series:abc")).toBe("insight:price");
    expect(insightView("weekday")).toBe("insight:weekday");
  });

  it("lists the old ones oldest first, and the sections never opened only once tracking is a quarter old", () => {
    const old = { since: "2026-01-10", today: "2026-10-09", days: 90, views: [{ view: "insight:price", lastDay: "2026-03-01" }, { view: "finding:loans:margin", lastDay: "2026-01-10" }], opened: ["insight:price", "finding:loans:margin", "report:ennuste"] };
    const rows = listed(old);
    expect(rows.filter((r) => r.lastDay !== null).map((r) => r.view)).toEqual(["finding:loans:margin", "insight:price"]);
    // sections that were never recorded come first (no last day)
    const never = rows.filter((r) => r.lastDay === null);
    expect(never.length).toBeGreaterThan(0);
    expect(never.every((r) => r.kind === "report")).toBe(true);
    // a section opened lately is not among them
    expect(never.some((r) => r.view === "report:ennuste")).toBe(false);
    const young = listed({ ...old, since: "2026-09-01", views: [] });
    expect(young).toEqual([]);
  });
});
