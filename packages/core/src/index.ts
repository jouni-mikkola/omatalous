/**
 * @banking/core: pure domain logic, no I/O. Runs on Node and in the browser.
 *
 *   merchant / categorize / transfers / pipeline   raw bank rows to enriched transactions
 *   industry                                       trade register industry code to category
 *   recurring                                      subscriptions, bills, habits, income
 *   analysis/*                                     money flows, context, dashboard, alerts, insights
 *   reports/*                                      report registry (one file per report)
 *   sources/*                                      import parsers (file text to raw rows), one folder each
 */
export * from "./types.ts";
export * from "./dates.ts";
export * from "./stats.ts";
export * from "./categories.ts";
export * from "./merchant.ts";
export * from "./local-origin.ts";
export * from "./categorize.ts";
export * from "./industry.ts";
export * from "./transfers.ts";
export * from "./recurring.ts";
export * from "./pipeline.ts";
export * from "./returns.ts";
export * from "./analysis/flows.ts";
export * from "./analysis/period.ts";
export * from "./analysis/format.ts";
export * from "./analysis/context.ts";
export * from "./analysis/alerts.ts";
export * from "./analysis/insights.ts";
export * from "./analysis/dashboard.ts";
export * from "./reports/index.ts";
export * from "./sources/index.ts";
export * from "./features.ts";
