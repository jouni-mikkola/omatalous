/**
 * The bank app form on the real server: a key file it refuses is said aloud, as an alert the file field points to.
 */
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { openApp, startServer } from "./dom-kit.ts";

const T = { timeout: 15000 };

describe("Pankkisovellus", () => {
  it("reads out a refused key file and ties the error to the file field", async () => {
    await startServer();
    await openApp("#/settings/banks", "Asetukset");
    fireEvent.click(await screen.findByRole("button", { name: "Näytä ohje" }, T));
    fireEvent.click(await screen.findByRole("button", { name: "Minulla on .pem-tiedosto", hidden: true }, T));
    const input = await screen.findByLabelText("Yksityinen avain (.pem)", {}, T);
    expect(input.getAttribute("aria-describedby")).toBeNull();
    // a file past the size of any key is refused before it is read
    const tooBig = new File([new Uint8Array(16 * 1024 + 1)], "kuva.pem");
    fireEvent.change(input, { target: { files: [tooBig] } });
    const error = await screen.findByRole("alert", {}, T);
    expect(error.textContent).toBe("Tiedosto ei ole avain. Valitse Enable Bankingin .pem-tiedosto.");
    expect(error.id).toBe("err-keyfile");
    await waitFor(() => expect(input.getAttribute("aria-describedby")).toBe(error.id), T);
    expect(input.getAttribute("aria-invalid")).toBe("true");
  }, 60000);
});
