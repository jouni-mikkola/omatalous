// An --answers module for `pnpm shots`: the first-run wizard, as the administrator of an install that is not set up yet sees it.
// Step 1 is the picture as it loads; for step 2 add --steps tools/shots-examples/steps-wizard-next.mjs.
// Try it: pnpm shots overview --answers tools/shots-examples/state-wizard.mjs --name wizard-1
export default {
  "/api/meta": (meta) => ({ ...meta, setupDone: false }),
};
