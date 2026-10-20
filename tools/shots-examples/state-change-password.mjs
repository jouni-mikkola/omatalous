// An --answers module for `pnpm shots`: the forced change of a temporary password, as a member who was given one sees it.
// Try it: pnpm shots overview --answers tools/shots-examples/state-change-password.mjs --name change-password
export default {
  "/api/auth/state": (state) => ({ ...state, user: { ...state.user, mustChangePassword: true } }),
};
