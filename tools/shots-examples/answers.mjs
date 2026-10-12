// An --answers module for `pnpm shots`: the page shows the answer this returns instead of the server's, so a state no
// household has can be looked at. Try it: pnpm shots overview --demo --answers tools/shots-examples/answers.mjs --name overspent
// A key is a path of the API without its query; the function takes the parsed answer and returns the one to show
// (or changes it in place and returns nothing). The figures are made up.
export default {
  // a month that costs more than it brings in
  "/api/dashboard": (dashboard) => ({
    ...dashboard,
    totals: { ...dashboard.totals, incomeCents: 250_000, expenseCents: 310_000, consumptionCents: 310_000, netCents: -60_000 },
  }),
};
