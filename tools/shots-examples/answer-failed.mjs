// An --answers module for `pnpm shots`: the page gets an error from the server instead of its answer, so its error state shows.
// { fail: { status, body } }: body is what the server sends with an error, { error: "..." }.
// Try it: pnpm shots overview --demo --answers tools/shots-examples/answer-failed.mjs --name failed
export default {
  "/api/dashboard": { fail: { status: 500, body: { error: "Palvelin ei pystynyt hakemaan tietoja." } } },
};
