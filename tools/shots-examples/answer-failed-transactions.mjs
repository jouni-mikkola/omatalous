// An --answers module for `pnpm shots`: the page of transactions gets an error instead of its main answer, so its error state shows.
// Try it: pnpm shots transactions --demo --answers tools/shots-examples/answer-failed-transactions.mjs --name failed
export default {
  "/api/transactions": { fail: { status: 500, body: { error: "Palvelin ei pystynyt hakemaan tietoja." } } },
};
