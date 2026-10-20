// An --answers module for `pnpm shots bills --demo`: a month with no bills on the board, as a month before the first
// charge is. The rest of the page stays as served.
export default {
  "/api/bill-month": (answer) => ({ ...answer, board: { ...answer.board, month: "2025-11", from: "2025-11-01", to: "2025-11-30", rows: [], totals: { paidCents: 0, comingCents: 0, missingCents: 0, dueCents: 0 } } }),
};
