// An --answers module for `pnpm shots`: the technical page with a working helper, a new version on offer and eight copies.
// Try it: pnpm shots "settings?section=technical" --demo --fake-bank --answers tools/shots-examples/answers-update-offered.mjs --steps tools/shots-examples/steps-open-update.mjs --name update
export default {
  "/api/ops/state": (ops) => {
    const at = (days) => new Date(Date.now() - days * 86_400_000).toISOString();
    const copy = (days, kind) => ({ name: `banking-${at(days).slice(0, 10)}-${kind}.db.gz`, size: 2_000_000 + days * 1000, at: at(days), kind });
    return {
      ...ops,
      helper: { ...ops.helper, status: "ok", reason: null, seenAt: new Date().toISOString(), outdated: false, tools: true, knowsPrerelease: true },
      state: { ...ops.state, version: "0.4.0", update_available: true, can_rollback: true, behind_commits: [{ hash: "abc1234", subject: "Made-up change" }] },
      appBackups: [0, 1, 2, 3, 4, 5, 6, 7].map((d) => copy(d, d % 3 === 0 ? "daily" : "manual")),
    };
  },
};
