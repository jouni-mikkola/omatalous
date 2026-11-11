/**
 * The routes of the app: a tree of typed routes on the hash history (`#/<page>?<search>#<anchor>`), so the address
 * stays what it always was and the app needs no server route for it. Every page is a lazy chunk of its own, loaded when
 * its link is near (`preload="intent"`) or when it is opened. The search parameters have a schema per page
 * (search.ts). An address from before the routes (`#/recurring`, `#/categories`, `?section=security`) is rewritten to
 * where it lives now (`redirectRoute` in routes.ts), with `replace`, so Back does not return to it.
 */
import {
  createHashHistory,
  createRootRouteWithContext,
  createRoute,
  createRouter,
  lazyRouteComponent,
  Navigate,
  redirect,

} from "@tanstack/react-router";
import { ErrorCard } from "./components/ErrorCard.tsx";
import { Loading } from "./components/Loading.tsx";

import { type Route, redirectRoute, SETTINGS_TARGETS, type SettingsTarget } from "./routes.ts";
import { parseSearch, searchOf, stringifySearch } from "./search.ts";
import { Shell } from "./Shell.tsx";

import type { User } from "./types.ts";


/** What the signed-in app gives the router (App.tsx): the user, whose role decides where an old address goes. */
export interface RouterContext {
  user: User;
  onSignedOut: () => void;
}

/** The route an address names, in the form `redirectRoute` reads. */
function routeOf(location: { pathname: string; searchStr: string; hash: string }): Route {
  // `settings/security` is one page id: only the bare `settings` is an old address
  const page = location.pathname.split("/").filter(Boolean).slice(0, 2).join("/") || "overview";
  return { page, params: new URLSearchParams(location.searchStr), ...(location.hash ? { anchor: location.hash } : {}) };
}

const rootRoute = createRootRouteWithContext<RouterContext>()({
  component: Shell,
  beforeLoad: ({ location, context }) => {
    const moved = redirectRoute(routeOf(location), context.user.role);
    if (!moved) return;
    // the page is a string here (an old address names pages the tree does not have), so the target is written as a path
    throw redirect({ to: `/${moved.page}` as "/", search: Object.fromEntries(moved.params), hash: moved.anchor, replace: true });
  },
});

// the address with no page (`#/`, or none) is the overview
const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  beforeLoad: ({ location }) => {
    throw redirect({ to: "/overview", search: Object.fromEntries(new URLSearchParams(location.searchStr)), hash: location.hash || undefined, replace: true });
  },
});

const overviewRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/overview",
  validateSearch: searchOf("overview"),
  component: lazyRouteComponent(() => import("./views/OverviewView.tsx"), "OverviewView"),
});
const billsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/bills",
  validateSearch: searchOf("bills"),
  component: lazyRouteComponent(() => import("./views/BillsView.tsx"), "BillsView"),
});
const transactionsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/transactions",
  validateSearch: searchOf("transactions"),
  component: lazyRouteComponent(() => import("./views/TransactionsView.tsx"), "TransactionsView"),
});
const reportsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/reports",
  validateSearch: searchOf("reports"),
  component: lazyRouteComponent(() => import("./views/ReportsView.tsx"), "ReportsView"),
});
const optimiseRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/optimise",
  validateSearch: searchOf("optimise"),
  component: lazyRouteComponent(() => import("./views/OptimiseView.tsx"), "OptimiseView"),
});
const reviewRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/review",
  validateSearch: searchOf("review"),
  component: lazyRouteComponent(() => import("./views/ReviewView.tsx"), "ReviewView"),
});
// Asetukset is a frame with the six targets as children (`#/settings/security`); the bare `#/settings` is rewritten to the
// first target by the root route (`redirectRoute`), which also sends a member away from the admin's target
const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings",
  validateSearch: searchOf("settings"),
  component: lazyRouteComponent(() => import("./views/SettingsView.tsx"), "SettingsView"),
});
/** The export of `views/SettingsTargetViews.tsx` that draws each target. */
const SETTINGS_TARGET_VIEW = {
  banks: "BanksView",
  household: "HouseholdView",
  members: "MembersView",
  security: "SecurityView",
  data: "DataView",
  server: "ServerView",
} as const satisfies Record<SettingsTarget, string>;
const settingsTargetRoutes = SETTINGS_TARGETS.map((target) =>
  createRoute({
    getParentRoute: () => settingsRoute,
    path: `/${target.id}`,
    validateSearch: searchOf("settings"),
    component: lazyRouteComponent(() => import("./views/SettingsTargetViews.tsx"), SETTINGS_TARGET_VIEW[target.id]),
  }),
);

const routeTree = rootRoute.addChildren([
  indexRoute,
  overviewRoute,
  billsRoute,
  transactionsRoute,
  reportsRoute,
  optimiseRoute,
  reviewRoute,
  settingsRoute.addChildren(settingsTargetRoutes),
]);

export const router = createRouter({
  routeTree,
  history: createHashHistory(),
  parseSearch,
  stringifySearch,
  // the router needs the user from the first address on; App.tsx gives it when someone is signed in
  context: undefined as unknown as RouterContext,
  defaultPreload: "intent",
  // a chunk that is not there yet shows the page's own placeholder at once, and a fast one does not flash it
  defaultPendingMs: 0,
  defaultPendingMinMs: 0,
  defaultPendingComponent: () => <Loading />,
  // a page's chunk that cannot be fetched (offline, or replaced by an upgrade) asks for a reload
  defaultErrorComponent: ({ error }) => <ErrorCard message={error instanceof Error ? error.message : String(error)} onRetry={() => window.location.reload()} />,
  defaultNotFoundComponent: () => <Navigate to="/overview" replace />,
  scrollRestoration: false,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
