// An --answers module for `pnpm shots`: the answer never comes, so the page is in its loading state in the picture.
// Try it: pnpm shots overview --demo --answers tools/shots-examples/answer-held.mjs --name loading
export default {
  "/api/dashboard": { hold: true },
};
