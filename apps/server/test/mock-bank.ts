import { randomUUID } from "node:crypto";

/** A fake Enable Banking API with a checking account and a Nordea Gold card. */
export function mockBank() {
  const bank = {
    calls: [] as string[],
    state: "",
    redirectUrl: "",
    /** Set to make POST /auth fail with this status and body, as for an unregistered redirect URL. */
    authFailure: null as null | { status: number; body: string },
    appIds: new Set<string>(),
    tokens: [] as string[],
    status: 200,
    /** The card's pending coffee gets booked (new identity at the bank). */
    pendingBooked: false,
    /** Set to refuse card fetches that start before this day, as Nordea's card API does past 12 months. */
    cardOldest: null as string | null,
    /** Answers that replace a route's own (or answer one it has not), keyed like "POST /sessions" or "GET /accounts/u-card/balances". */
    answers: {} as Record<string, { status: number; body: unknown }>,
    fetchMock: undefined as unknown as typeof fetch,
  };
  bank.fetchMock = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const route = `${init?.method ?? "GET"} ${url.pathname}`;
    bank.calls.push(`${route}${url.search}`);
    const auth = new Headers(init?.headers).get("Authorization") ?? "";
    const header = JSON.parse(Buffer.from(auth.replace("Bearer ", "").split(".")[0]!, "base64url").toString());
    bank.appIds.add(header.kid);
    bank.tokens.push(auth.replace("Bearer ", ""));
    // simulate Enable Banking rejecting the key (e.g. 401 for a wrong Application ID)
    if (bank.status !== 200) return new Response(JSON.stringify({ error: "UNAUTHORIZED" }), { status: bank.status });
    if (route === "POST /auth") {
      if (bank.authFailure) return new Response(bank.authFailure.body, { status: bank.authFailure.status });
      const sent = JSON.parse(String(init?.body));
      bank.state = sent.state;
      bank.redirectUrl = sent.redirect_url;
    }
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
    const tx = (id: string | null, euros: string, dir: "CRDT" | "DBIT", date: string, text: string, extra = {}) => ({
      entry_reference: id,
      transaction_amount: { currency: "EUR", amount: euros },
      credit_debit_indicator: dir,
      status: "BOOK",
      booking_date: date,
      remittance_information: [text],
      ...extra,
    });
    const answer = bank.answers[route];
    if (answer) return new Response(JSON.stringify(answer.body), { status: answer.status });
    if (route.startsWith("DELETE /sessions/")) return new Response(null, { status: 204 });
    switch (route) {
      case "GET /aspsps":
        return json({ aspsps: [{ name: "Nordea", country: "FI", maximum_consent_validity: 180 * 86400 }] });
      case "POST /auth":
        return json({ url: "https://auth.enablebanking.com/consent?x=1", authorization_id: "auth-1" });
      case "POST /sessions":
        return json({
          session_id: `sess-${randomUUID()}`,
          aspsp: { name: "Nordea", country: "FI" },
          access: { valid_until: "2027-04-06T00:00:00Z" },
          accounts: [
            { uid: "u-chk", identification_hash: "h-chk", account_id: { iban: "FI2112345600000785" }, name: "Käyttötili", currency: "EUR", cash_account_type: "CACC" },
            { uid: "u-card", identification_hash: "h-card", name: "Nordea Gold", currency: "EUR", cash_account_type: "CARD" },
          ],
        });
      case "GET /accounts/u-chk/transactions":
        return url.searchParams.get("continuation_key")
          ? json({ transactions: [tx("c2", "300.00", "DBIT", "2026-10-05", "NORDEA GOLD LASKU", { creditor: { name: "NORDEA RAHOITUS SUOMI OY" } })] })
          : json({ transactions: [tx("c1", "3420.00", "CRDT", "2026-09-25", "PALKKA", { debtor: { name: "ACME OY" } })], continuation_key: "page2" });
      case "GET /accounts/u-card/transactions":
        if (bank.cardOldest && (url.searchParams.get("date_from") ?? "") < bank.cardOldest) {
          return new Response(JSON.stringify({ error: "ASPSP_ERROR", message: "Bad Request" }), { status: 400 });
        }
        return json({
          transactions: [
            tx("k1", "300.00", "DBIT", "2026-09-12", "WOLT HELSINKI", { merchant_category_code: "5814" }),
            tx(null, "300.00", "CRDT", "2026-10-05", "MAKSU KIITOS"),
            { ...tx(null, "8.50", "DBIT", "2026-10-08", "ESPRESSO HOUSE"), status: bank.pendingBooked ? "BOOK" : "PDNG" },
          ],
        });
      case "GET /accounts/u-chk/balances":
      case "GET /accounts/u-card/balances":
        return json({ balances: [{ balance_amount: { currency: "EUR", amount: "1234.56" }, balance_type: "CLBD" }] });
      default:
        return new Response("not found", { status: 404 });
    }
  }) as typeof fetch;
  return bank;
}
