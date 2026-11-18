/**
 * The file of a table is handed to the browser by an address that must outlive the click: an address revoked at once can
 * cancel the download before the browser has read it (the Tapahtumat file, which is made after a fetch, arrived or not by chance).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { saveCsv } from "../src/components/table/csv.ts";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("saveCsv", () => {
  it("clicks a download link and revokes the file's address only after the browser has had time to read it", () => {
    vi.useFakeTimers();
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:file");
    const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    saveCsv("Tapahtumat", "a;b");
    expect(click).toHaveBeenCalledTimes(1);
    expect(revoke).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(revoke).toHaveBeenCalledWith("blob:file");
  });
});
