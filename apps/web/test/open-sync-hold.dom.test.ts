/** Rows that arrive while a picked bank file is on screen must not remount the page (`holdsPage`). */
import { render } from "@testing-library/react";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { holdsPage } from "../src/open-sync.ts";
import { BankRows } from "../src/pages/settings/BankFile.tsx";
import { CardRows } from "../src/pages/settings/CardFile.tsx";

describe("holdsPage", () => {
  it("is false on a bare page and true while a picked bank file is shown", () => {
    expect(holdsPage(document)).toBe(false);
    const meta = { accounts: [] } as unknown as Parameters<typeof BankRows>[0]["meta"];
    const view = render(createElement(BankRows, { text: "Päivä;Summa\n1.1.2025;-5,00\n", meta, onChange: () => {} }));
    expect(holdsPage(document)).toBe(true);
    view.unmount();
    expect(holdsPage(document)).toBe(false);
  });

  it("is true while a picked card file is shown", () => {
    const meta = { accounts: [] } as unknown as Parameters<typeof CardRows>[0]["meta"];
    const view = render(createElement(CardRows, { text: "Päivä;Summa\n1.1.2025;-5,00\n", meta, onChange: () => {} }));
    expect(holdsPage(document)).toBe(true);
    view.unmount();
    expect(holdsPage(document)).toBe(false);
  });
});
