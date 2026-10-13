// An --answers module for `pnpm shots`: the sign-in form, as a browser with no session sees it.
// Try it: pnpm shots overview --answers tools/shots-examples/state-sign-in.mjs --name sign-in --look light
export default {
  "/api/auth/state": () => ({ needsSetup: false, user: null }),
};
