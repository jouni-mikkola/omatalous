// An --answers module for `pnpm shots bills --demo`: the month board with a missed bill, which the demo household has
// not. Elisa's phone bill was due on the 12th and no charge came. The figures are made up.
export default {
  "/api/bill-month": (answer) => {
    const { board } = answer;
    const elisa = board.rows.find((r) => r.merchant === "Elisa" && r.state === "coming");
    if (!elisa) return answer;
    elisa.state = "missing";
    elisa.date = `${board.month}-12`;
    board.rows = [elisa, ...board.rows.filter((r) => r !== elisa)];
    board.totals.comingCents -= elisa.cents;
    board.totals.missingCents += elisa.cents;
    return answer;
  },
};
