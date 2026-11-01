/**
 * The one cache of the answers the pages read (TanStack Query behind `useApi`, hooks.ts). The key of an answer is its
 * path. The cache is empty at a sign-in and a sign-out (App.tsx), since an answer belongs to the user who asked.
 */
import { QueryClient } from "@tanstack/react-query";

/** How long an answer counts as fresh: a page opened again inside this time shows it at once and asks for nothing. */
export const FRESH_MS = 60_000;

/** The path whose answer carries the data version (`GET /api/meta`): it is never dropped by a version change it announces itself. */
export const META_PATH = "/api/meta";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: FRESH_MS,
      // api() answers a lost connection from the figures kept on the device (offline.ts), so a query runs offline too
      networkMode: "always",
      // a failure is shown on the page, and its button asks again
      retry: false,
      // the shell asks for /api/meta when the tab comes back (App.tsx); the rest is read when its page opens
      refetchOnWindowFocus: false,
    },
  },
});

/** Marks every answer old and reads the open ones again. `except` keeps the answer of a path (the one that announced the change). */
export function dropAnswers(except?: string): Promise<void> {
  return queryClient.invalidateQueries({ predicate: (q) => q.queryKey[0] !== except });
}

/** Forgets every answer: another user, or none, is at the page now. */
export function forgetAnswers(): void {
  queryClient.clear();
}
