// An --answers module for `pnpm shots bills --demo`: the month board fails as the server fails, so the page shows its error.
export default { "/api/bill-month": { fail: { status: 503, body: { error: "Palvelu ei vastaa. Yritä myöhemmin uudelleen." } } } };
