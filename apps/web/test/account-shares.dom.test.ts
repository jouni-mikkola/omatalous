/**
 * The share boxes of an account: the saves go one after the other in the order of the clicks, so the last click wins,
 * and the answer to an earlier click never redraws a box the reader has clicked since.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AccountShares } from "../src/pages/settings/AccountShares.tsx";
import type { Meta } from "../src/types.ts";

const meta = {
  user: { id: "u1" },
  members: [
    { id: "u1", displayName: "Matti" },
    { id: "u2", displayName: "Elisa" },
    { id: "u3", displayName: "Pekka" },
  ],
  shares: [],
} as unknown as Meta;

interface Save {
  method: string;
  path: string;
  answer: (ok: boolean) => void;
}

/** Every share save waits for the test to answer it; any other request is answered at once. */
function stubSaves() {
  const saves: Save[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init?: { method?: string }) => {
      const method = init?.method ?? "GET";
      const json = { headers: { "content-type": "application/json" } };
      if (method !== "PUT" && method !== "DELETE") return new Response("{}", { status: 200, ...json });
      const ok = await new Promise<boolean>((resolve) => saves.push({ method, path: input, answer: resolve }));
      return ok ? new Response("{}", { status: 200, ...json }) : new Response(JSON.stringify({ error: "Tallennus epäonnistui" }), { status: 500, ...json });
    }),
  );
  return saves;
}

const box = (name: string) => screen.getByRole("checkbox", { name: new RegExp(name) }) as HTMLInputElement;

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Tilin jakovalinnat", () => {
  it("sends the saves one at a time in the order of the clicks, so the last click is what the server ends with", async () => {
    const saves = stubSaves();
    const onChange = vi.fn();
    render(createElement(AccountShares, { accountId: "a1", meta, onChange }));
    fireEvent.click(box("Elisa"));
    fireEvent.click(box("Elisa"));
    expect(box("Elisa").checked).toBe(false);
    await waitFor(() => expect(saves).toHaveLength(1));
    expect(saves[0]!.method).toBe("PUT");
    // the second save waits for the first
    await new Promise((r) => setTimeout(r, 20));
    expect(saves).toHaveLength(1);
    saves[0]!.answer(true);
    await waitFor(() => expect(saves).toHaveLength(2));
    expect(saves[1]!.method).toBe("DELETE");
    // the page is read again once, after the last save, and the box still shows the last click
    expect(onChange).not.toHaveBeenCalled();
    saves[1]!.answer(true);
    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    expect(box("Elisa").checked).toBe(false);
  });

  it("puts back only the box whose save failed and leaves a later click as it is", async () => {
    const saves = stubSaves();
    render(createElement(AccountShares, { accountId: "a1", meta, onChange: () => {} }));
    fireEvent.click(box("Elisa"));
    fireEvent.click(box("Pekka"));
    await waitFor(() => expect(saves).toHaveLength(1));
    saves[0]!.answer(false);
    await screen.findByRole("alert");
    expect(box("Elisa").checked).toBe(false);
    expect(box("Pekka").checked).toBe(true);
    await waitFor(() => expect(saves).toHaveLength(2));
    expect(saves[1]!.path).toContain("/shares/u3");
    saves[1]!.answer(true);
    await waitFor(() => expect(box("Pekka").checked).toBe(true));
  });

  it("keeps a box the reader clicked again after its first save failed", async () => {
    const saves = stubSaves();
    render(createElement(AccountShares, { accountId: "a1", meta, onChange: () => {} }));
    fireEvent.click(box("Elisa"));
    fireEvent.click(box("Elisa"));
    fireEvent.click(box("Elisa"));
    await waitFor(() => expect(saves).toHaveLength(1));
    saves[0]!.answer(false);
    await waitFor(() => expect(saves).toHaveLength(2));
    expect(box("Elisa").checked).toBe(true);
    saves[1]!.answer(true);
    await waitFor(() => expect(saves).toHaveLength(3));
    saves[2]!.answer(true);
    await waitFor(() => expect(saves[2]!.method).toBe("PUT"));
    expect(box("Elisa").checked).toBe(true);
  });
});
