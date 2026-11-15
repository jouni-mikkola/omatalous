/**
 * Miksi? on the real server: a figure of Laskut opens the rows it is made of, with the sum they add up to,
 * and closes again.
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createElement } from "react";
import { expect, it } from "vitest";
import { openApp, startServer, stubApi } from "./dom-kit.ts";
import { Why } from "../src/components/Why.tsx";

const T = { timeout: 20000 };

it("opens the rows behind a spending figure and closes them", async () => {
  const server = await startServer();
  await openApp("#/bills");
  const doors = await screen.findAllByRole("button", { name: /^Näytä tapahtumat: /, hidden: true }, T);
  fireEvent.click(doors[0]!);
  const dialog = await screen.findByRole("dialog", { hidden: true });
  await waitFor(() => expect(server.seen.some((s) => /^\/api\/explain/.test(s.path))).toBe(true), T);
  await waitFor(() => expect(dialog.textContent).not.toContain("Ladataan…"), T);
  expect(within(dialog).queryByRole("alert", { hidden: true })).toBeNull();
  // the rows add up to the figure the door carried, which Laskut prints in whole euros
  const total = await waitFor(() => dialog.querySelector("[data-why-total]")!, T);
  const euros = Math.round(Number(total.textContent!.replace(/[^\d,−-]/g, "").replace(",", ".")));
  expect(doors[0]!.getAttribute("aria-label")!.replace(/\s/g, "")).toContain(`${euros}€`);
  expect(dialog.querySelectorAll("tbody tr").length).toBeGreaterThan(0);
  fireEvent.click(within(dialog).getByRole("button", { name: "Sulje", hidden: true }));
  await waitFor(() => expect(document.querySelector("dialog.why")).toBeNull(), T);
}, 90000);

it("moves the focus to the first row \"Näytä kaikki\" brings and says how many rows there are", async () => {
  // 52 rows: the sheet shows 50 of them first
  const lines = Array.from({ length: 52 }, (_, i) => ({ id: `t${i + 1}`, day: "2026-03-01", cents: 100, why: [] }));
  const rows = lines.map((l) => ({ id: l.id, merchant: `Kauppa ${l.id}`, category: "ruoka" }));
  stubApi({ "GET /api/explain": { figure: "spend.category", kind: "sum", cents: 5200, lines, rows, check: { kind: "sum", diffCents: 0 } } });
  render(createElement(Why, { figure: "spend.category", title: "Ruoka", range: { from: "2026-03-01", to: "2026-03-31" }, scope: "household", category: "ruoka", children: "52,00 €" }));
  fireEvent.click(screen.getByRole("button", { hidden: true }));
  const dialog = await screen.findByRole("dialog", { hidden: true });
  const all = await within(dialog).findByRole("button", { name: "Näytä kaikki", hidden: true }, T);
  expect(dialog.querySelectorAll("[data-why-row]")).toHaveLength(50);
  const live = dialog.querySelector("[data-why-count]")!;
  expect(live.textContent).toBe("");
  all.focus();
  fireEvent.click(all);
  await waitFor(() => expect(dialog.querySelectorAll("[data-why-row]")).toHaveLength(52), T);
  // the button is gone: the focus is on the first row that came, inside the sheet's table
  expect(within(dialog).queryByRole("button", { name: "Näytä kaikki", hidden: true })).toBeNull();
  expect(document.activeElement).toBe(dialog.querySelector('[data-why-row="t51"]'));
  expect(dialog.querySelector("table.why-rows, .why-rows table")!.contains(document.activeElement)).toBe(true);
  expect(live.getAttribute("role")).toBe("status");
  expect(live.getAttribute("aria-live")).toBe("polite");
  expect(live.textContent).toMatch(/52 \/ 52/);
}, 30000);
