import { createContext, useContext } from "react";
import type { Meta, Scope, User } from "./types.ts";

/**
 * What the shell (App.tsx) has worked out for the page it holds: the household's meta, the scope and period it shows, the
 * address as the parameters the pages read, and what an empty household is offered. The views (views/) read it and hand
 * the page its props, so a page does not know about the router.
 */
export interface ShellState {
  meta: Meta;
  scope: Scope;
  period: string;
  range: { from: string; to: string };
  params: URLSearchParams;
  /** The part after a second `#`: a spot on the page to scroll to. */
  anchor?: string;
  /** No account and nothing shared: a page that needs rows shows the start card instead. */
  noData: boolean;
  loadDemo: () => Promise<void>;
  showHousehold: () => void;
  reloadMeta: () => void;
  /** Raportit tells the shell which question it opened, which the address alone does not settle: the shell hides the period switch for the running month's. */
  setReportQuestion: (question: string | null) => void;
  /** How many questions are open (the header's mark and the title of Tarkistettavat). */
  open: number;
}

export const ShellContext = createContext<ShellState | null>(null);

export function useShell(): ShellState {
  const shell = useContext(ShellContext);
  if (!shell) throw new Error("useShell needs the shell around it");
  return shell;
}

/**
 * Who is signed in, from the gate (App.tsx). The shell reads it here and not from the router's context: a route keeps the
 * context it matched with, so after another user signs in without a reload it would still show the one before.
 */
export interface Session {
  user: User;
  onSignedOut: () => void;
}

export const SessionContext = createContext<Session | null>(null);

export function useSession(): Session {
  const session = useContext(SessionContext);
  if (!session) throw new Error("useSession outside the signed-in app");
  return session;
}
