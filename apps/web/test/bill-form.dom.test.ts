/**
 * The bill form: a bad entry marks its field and takes the focus, a good one posts the same body as before.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { BillForm } from "../src/components/bills/BillForm.tsx";
import { stubApi } from "./dom-kit.ts";

const open = () => {
  const onAdded = vi.fn();
  render(createElement(BillForm, { today: "2026-06-01", onAdded, onCancel: () => {} }));
  const field = (label: string) => screen.getByLabelText(label) as HTMLInputElement;
  const submit = () => fireEvent.click(screen.getByRole("button", { name: "Lisää lasku", hidden: true }));
  return { onAdded, name: () => field("Nimi"), amount: () => field("Summa"), due: () => field("Eräpäivä"), submit };
};
const marked = (...els: HTMLElement[]) => els.map((e) => e.getAttribute("aria-invalid"));

describe("Laskulomake", () => {
  it("marks a missing name and focuses it", async () => {
    const f = open();
    fireEvent.change(f.amount(), { target: { value: "12,50" } });
    fireEvent.change(f.due(), { target: { value: "2026-06-10" } });
    f.submit();
    await waitFor(() => expect(f.name().getAttribute("aria-invalid")).toBe("true"));
    expect(marked(f.amount(), f.due())).toEqual([null, null]);
    expect(document.activeElement).toBe(f.name());
    expect(screen.getByText("Anna laskulle nimi.")).toBeTruthy();
    fireEvent.change(f.name(), { target: { value: "Vero" } });
    expect(f.name().getAttribute("aria-invalid")).toBeNull();
  });

  it.each(["abc", "0", "0,004"])("marks the sum %s and focuses it", async (sum) => {
    const f = open();
    fireEvent.change(f.name(), { target: { value: "Vero" } });
    fireEvent.change(f.amount(), { target: { value: sum } });
    fireEvent.change(f.due(), { target: { value: "2026-06-10" } });
    f.submit();
    await waitFor(() => expect(f.amount().getAttribute("aria-invalid")).toBe("true"));
    expect(marked(f.name(), f.due())).toEqual([null, null]);
    expect(document.activeElement).toBe(f.amount());
    expect(screen.getByText("Anna summa euroina, esimerkiksi 312,50.")).toBeTruthy();
  });

  it("marks a missing day, and focuses the first of several bad fields", async () => {
    const f = open();
    fireEvent.change(f.name(), { target: { value: "Vero" } });
    fireEvent.change(f.amount(), { target: { value: "12" } });
    f.submit();
    await waitFor(() => expect(f.due().getAttribute("aria-invalid")).toBe("true"));
    expect(marked(f.name(), f.amount())).toEqual([null, null]);
    expect(document.activeElement).toBe(f.due());
    expect(screen.getByText("Valitse eräpäivä.")).toBeTruthy();

    fireEvent.change(f.name(), { target: { value: "" } });
    fireEvent.change(f.amount(), { target: { value: "x" } });
    f.submit();
    await waitFor(() => expect(document.activeElement).toBe(f.name()));
    expect(marked(f.name(), f.amount(), f.due())).toEqual(["true", "true", "true"]);
  });

  it("posts a good entry with the same body", async () => {
    const seen = stubApi({ "POST /api/expected-bills": {} });
    const f = open();
    fireEvent.change(f.name(), { target: { value: " Vero " } });
    fireEvent.change(f.amount(), { target: { value: "312,50" } });
    fireEvent.change(f.due(), { target: { value: "2026-06-10" } });
    f.submit();
    await waitFor(() => expect(f.onAdded).toHaveBeenCalledWith("Vero"));
    expect(seen.map((s) => [s.method, s.path, s.body])).toEqual([
      ["POST", "/api/expected-bills", { name: "Vero", amountCents: 31250, dueDate: "2026-06-10", cadence: "yearly" }],
    ]);
    expect(marked(f.name(), f.amount(), f.due())).toEqual([null, null, null]);
  });
});
