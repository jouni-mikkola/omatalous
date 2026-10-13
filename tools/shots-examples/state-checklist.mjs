// An --answers module for `pnpm shots`: the Enable Banking app has a key made but no certificate loaded and no working Application ID,
// so the checklist of Asetukset shows one step done and the rest not.
// Try it: pnpm shots "settings?section=server" --demo --answers tools/shots-examples/state-checklist.mjs --only ".checklist" --name checklist
export default {
  "/api/admin/instance": (state) => ({
    ...state,
    bankApp: { ...state.bankApp, source: null, appId: null, savedAt: null, hasCertificate: false, pendingSince: "2026-10-01T09:00:00.000Z" },
  }),
};
