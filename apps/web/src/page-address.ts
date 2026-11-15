import { createContext, useContext } from "react";

/**
 * The search parameters of the open page and the way to change them. The shell provides it (router.tsx); a component
 * that keeps state in the address (the order of a table, an open row) reads it, and keeps the state to itself where
 * there is none (a test, a page drawn outside the shell).
 */
export interface PageAddress {
  readonly search: Readonly<Record<string, string | undefined>>;
  /** Lays `patch` over the parameters; an undefined value removes its parameter. Replaces the entry in the history: a press of a sort head is no step Back should undo. */
  change(patch: Record<string, string | undefined>): void;
}

export const PageAddressContext = createContext<PageAddress | null>(null);

export const usePageAddress = (): PageAddress | null => useContext(PageAddressContext);
