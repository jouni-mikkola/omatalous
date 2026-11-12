/** Turvallisuusloki: Lisätieto says what the other columns of the row do not, and is empty otherwise. */
import { createElement, Fragment } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { eventDetail } from "../src/pages/settings/Security.tsx";

const cell = (detail: string | null, username: string | null) => renderToStaticMarkup(createElement(Fragment, null, eventDetail({ detail, username })));

describe("eventDetail", () => {
  it("is empty for a typed name that is the row's user, and for no detail, so a phone drops the label", () => {
    expect(cell("testi", "testi")).toBe("");
    expect(cell(null, "testi")).toBe("");
  });

  it("keeps a name nobody has, a device label, which a phone shows nowhere else, and any other detail", () => {
    expect(cell("tuntematon-nimi", null)).toContain(">tuntematon-nimi<");
    expect(cell("Firefox, Linux", "testi")).toContain(">Firefox, Linux<");
    expect(cell("komentorivi", "testi")).toContain(">komentorivi<");
  });
});
