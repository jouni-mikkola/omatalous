import { useEffect, useSyncExternalStore } from "react";
import { loadMarkup, markupReady } from "./columns.ts";
import { loadToolbar } from "./LazyToolbar.ts";

let parts: Promise<unknown> | null = null;

/** Fetches the toolbar and the renderer; a page whose long table is not drawn yet calls it so they are there with the rows. */
export const loadTableParts = (): Promise<unknown> => (parts ??= Promise.all([loadToolbar(), loadMarkup()]));

/**
 * Whether the renderer of columns.ts has arrived. A cell made of components reads as empty until it has, so the table
 * makes its search and labels again when this turns true. `wanted`: the table is long enough to be searched or saved as
 * CSV, so the parts are fetched at once and not when a cell first needs it.
 */
export function useMarkup(wanted: boolean): boolean {
  // the table never suspends here: a suspension during a synchronous update swaps the rows for a loading view
  useEffect(() => {
    if (wanted) void loadTableParts();
  }, [wanted]);
  return useSyncExternalStore(markupReady.subscribe, markupReady.get, () => false);
}
