import { describe, expect, it } from "vitest";
import { paramsOf, parseSearch, searchOf, stringifySearch } from "../src/search.ts";
import { readTableState, sortOf, sortValue, tableId, writeTableState } from "../src/table-state.ts";
import { redirectRoute } from "../src/routes.ts";
import { dropAnswers, forgetAnswers, queryClient } from "../src/query-client.ts";
import { publishReviewCount, REVIEW_COUNT_PATH } from "../src/review-count.ts";

describe("the search of an address", () => {
  it("is read and written in the plain form old links have", () => {
    expect(parseSearch("?period=12m&view=merchants")).toEqual({ period: "12m", view: "merchants" });
    expect(stringifySearch({ period: "12m", view: "merchants" })).toBe("?period=12m&view=merchants");
    expect(stringifySearch({})).toBe("");
    expect(stringifySearch({ a: "", b: undefined, c: { x: 1 }, d: 5 })).toBe("?d=5");
    expect(paramsOf({ period: "6m", tab: "menot" }).get("tab")).toBe("menot");
  });

  it("keeps the fields a page names when they are valid and drops those that are not", () => {
    const read = searchOf("transactions");
    expect(read({ view: "merchants", kind: "income", habit: "1", period: "12m" })).toEqual({ view: "merchants", kind: "income", habit: "1", period: "12m" });
    expect(read({ view: "nonsense", kind: "other", habit: "yes", q: "" })).toEqual({});
  });

  it("reads a parameter named like an object property as a plain parameter, never as a field", () => {
    const read = searchOf("reports");
    expect(() => read(JSON.parse('{"__proto__":"x","constructor":"y","toString":"z","period":"6m"}'))).not.toThrow();
    expect(read(JSON.parse('{"constructor":"y","toString":"z","period":"6m"}'))).toEqual({ constructor: "y", toString: "z", period: "6m" });
  });

  it("lets a parameter the page does not name through as a plain value", () => {
    expect(searchOf("overview")({ koodi: "abc", x: { y: 1 } })).toEqual({ koodi: "abc" });
  });
});

describe("the state of the tables in the address", () => {
  it("is one parameter with a value per table", () => {
    const one = writeTableState(undefined, "kauppiaat", "desc.total");
    expect(one).toBe("kauppiaat:desc.total");
    const two = writeTableState(one, "tilit", "asc.name");
    expect([...readTableState(two)]).toEqual([["kauppiaat", "desc.total"], ["tilit", "asc.name"]]);
    expect(writeTableState(two, "kauppiaat", null)).toBe("tilit:asc.name");
    expect(writeTableState("tilit:asc.name", "tilit", null)).toBeUndefined();
  });

  it("leaves out an entry that is not one, so a hand-made address cannot break a page", () => {
    expect([...readTableState("a:b,broken,c:d:e,%E0:x,f:g")]).toEqual([["a", "b"], ["f", "g"]]);
    expect(searchOf("reports")({ sort: "broken" })).toEqual({});
  });

  it("names a table by its caption and a sort by direction and key", () => {
    expect(tableId("Kauppiaat, kuukausittain")).toBe("kauppiaat-kuukausittain");
    expect(sortOf(sortValue({ key: "total", dir: "descending" }))).toEqual({ key: "total", dir: "descending" });
    expect(sortOf(sortValue({ key: "name", dir: "ascending" }))).toEqual({ key: "name", dir: "ascending" });
    expect(sortOf("up.total")).toBeNull();
    expect(sortOf(undefined)).toBeNull();
  });
});

describe("old addresses", () => {
  // an anchor is kept without its `#`
  const route = (page: string, query = "", anchor?: string) => ({ page, params: new URLSearchParams(query), ...(anchor ? { anchor } : {}) });
  const moved = (from: ReturnType<typeof route>) => {
    const to = redirectRoute(from);
    return to && { page: to.page, query: to.params.toString(), anchor: to.anchor };
  };

  it("move to the page that has the content now, with their parameters and anchor", () => {
    expect(moved(route("recurring", "", "kuukaudet"))).toEqual({ page: "bills", query: "", anchor: "kuukaudet" });
    expect(moved(route("categories", "tab=rules"))).toEqual({ page: "transactions", query: "view=merchants", anchor: "saannot" });
    expect(moved(route("overview", "period=12m"))).toEqual({ page: "reports", query: "period=12m", anchor: undefined });
    expect(moved(route("reports", "period=month"))).toEqual({ page: "overview", query: "period=month", anchor: undefined });
    expect(moved(route("transactions", "view=merchants"))).toBeNull();
  });
});

describe("the cache of answers", () => {
  it("is dropped at a write except the answer that announced it, and the review count can be set by the page", async () => {
    forgetAnswers();
    queryClient.setQueryData(["/api/meta"], { a: 1 });
    queryClient.setQueryData(["/api/dashboard"], { b: 2 });
    await dropAnswers("/api/meta");
    expect(queryClient.getQueryState(["/api/meta"])?.isInvalidated).toBe(false);
    expect(queryClient.getQueryState(["/api/dashboard"])?.isInvalidated).toBe(true);
    publishReviewCount(4);
    expect(queryClient.getQueryData([REVIEW_COUNT_PATH])).toEqual({ count: 4 });
    forgetAnswers();
    expect(queryClient.getQueryData(["/api/dashboard"])).toBeUndefined();
  });
});
