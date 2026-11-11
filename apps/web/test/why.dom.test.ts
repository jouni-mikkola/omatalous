/**
 * Miksi? on the real server: a figure of Laskut opens the rows it is made of, with the sum they add up to,
 * and closes again.
 */
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { expect, it } from "vitest";
import { openApp, startServer } from "./dom-kit.ts";

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
