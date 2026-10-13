// An --answers module for `pnpm shots`: the page of reports gets an error instead of its main answer, so its error state shows.
// Try it: pnpm shots reports --demo --answers tools/shots-examples/answer-failed-reports.mjs --name failed
export default {
  "/api/reports": { fail: { status: 500, body: { error: "Palvelin ei pystynyt hakemaan tietoja." } } },
};
