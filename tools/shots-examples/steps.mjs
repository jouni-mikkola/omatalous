// A --steps module for `pnpm shots`: run for every picture after the page has loaded and before it is taken.
// Try it: pnpm shots overview --demo --steps tools/shots-examples/steps.mjs --name earlier
// `page` is the Playwright page at the width of the picture; `route` is the one the picture is of, like "overview".
export default async (page, route) => {
  // the second choice of the period switch, the month before the running one
  if (route.startsWith("overview")) await page.getByRole("toolbar", { name: "Aikaväli" }).getByRole("button").nth(1).click();
};
