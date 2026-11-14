/** Hae nyt: the notice follows the status of the answer, so a failed fetch is never shown as a success. */
import { describe, expect, it } from "vitest";
import { syncResult } from "../src/pages/settings/sync-result.ts";

describe("syncResult", () => {
  it("says a fetch that worked is good and counts the new rows", () => {
    expect(syncResult({ status: "ok", inserted: 3, messages: [] })).toEqual({ tone: "good", text: "3 uutta tapahtumaa." });
    expect(syncResult({ status: "ok", inserted: 1, messages: [] })).toEqual({ tone: "good", text: "1 uusi tapahtuma." });
  });

  it("warns when some accounts failed and names them with the rows that did come", () => {
    const r = syncResult({ status: "partial", inserted: 2, messages: ["Käyttötili: haku epäonnistui."] });
    expect(r).toEqual({ tone: "warning", text: "2 uutta tapahtumaa. Käyttötili: haku epäonnistui." });
  });

  it("shows a failed fetch as an error with the reason, never as a success", () => {
    const r = syncResult({ status: "failed", inserted: 0, messages: ["Käyttötili: haku epäonnistui."] });
    expect(r).toEqual({ tone: "error", text: "Käyttötili: haku epäonnistui." });
  });

  it("still says it failed when the answer holds no reason", () => {
    expect(syncResult({ status: "failed", inserted: 0, messages: [] })).toEqual({ tone: "error", text: "Haku epäonnistui." });
  });

  it("gives a fetch that did not start as information, with no count", () => {
    expect(syncResult({ status: "skipped", inserted: 0, messages: ["Haku on jo käynnissä."] })).toEqual({ tone: "info", text: "Haku on jo käynnissä." });
  });
});
