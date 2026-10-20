// An --answers module for `pnpm shots`: the first-run form, as a server with no administrator yet shows it.
// Try it: pnpm shots overview --answers tools/shots-examples/state-first-run.mjs --name first-run --look night
export default {
  "/api/auth/state": () => ({ needsSetup: true, user: null }),
};
