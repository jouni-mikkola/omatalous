import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement as h } from "react";
import { describe, expect, it } from "vitest";
import { App } from "../src/App.tsx";
import { startServer } from "./dom-kit.ts";

describe("App: the gate", () => {
  it("signs in through the form and opens the overview of the demo household", async () => {
    const server = await startServer({ signedIn: false });
    render(h(App));
    fireEvent.change(await screen.findByLabelText("Käyttäjätunnus"), { target: { value: server.username } });
    fireEvent.change(screen.getByLabelText("Salasana"), { target: { value: server.password } });
    fireEvent.click(screen.getByRole("button", { name: "Kirjaudu sisään" }));
    expect(await screen.findByRole("navigation", { name: "Päävalikko" }, { timeout: 10000 })).toBeTruthy();
    await waitFor(() => expect(window.location.hash).toContain("/overview"));
  }, 30000);
});
