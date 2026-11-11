/**
 * Asetukset > Pankit ja tilit > Tuo tiedot on the real server: the household's own export read back has nothing to
 * add. The import never changes a row, so Tuo would do nothing; the dry run says so and offers only Peruuta.
 */
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { openApp, startServer } from "./dom-kit.ts";

const T = { timeout: 15000 };

describe("Tuo tiedot: a file with nothing new", () => {
  it("says the file has nothing new and offers no Tuo", async () => {
    const server = await startServer();
    const exported = await server.admin.call("POST", "/api/data/export");
    expect(exported.status).toBe(200);
    await openApp("#/settings/banks", "Asetukset");
    await screen.findByRole("button", { name: "Tuo tiedot" }, T);
    const input = document.querySelector<HTMLInputElement>('input[type="file"][accept^=".json"]')!;
    const text = JSON.stringify(exported.body);
    fireEvent.change(input, { target: { files: [new File([text], "omatalous.json", { type: "application/json" })] } });
    await screen.findByText("Tiedostossa ei ole mitään uutta.", {}, T);
    expect(screen.queryByRole("button", { name: "Tuo" })).toBeNull();
    expect(screen.getByRole("button", { name: "Peruuta" })).toBeTruthy();
    await waitFor(() => expect(server.seen.some((s) => s.path.endsWith("/check"))).toBe(true), T);
    expect(server.seen.some((s) => s.path.endsWith("/commit"))).toBe(false);
  }, 60000);
});
