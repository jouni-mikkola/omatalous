import { randomUUID } from "node:crypto";
import { crc32, deflateSync } from "node:zlib";

/** The made-up holder and valid test IBAN of the fake bank's checking account. */
export const HOLDER = "Testi Esimerkki";
export const HOLDER_IBAN = "FI2112345600000785";

/** As Nordea answers: the holder in `name`, the product apart, CACC for a current account. */
const CHECKING = { uid: "u-chk", identification_hash: "h-chk", account_id: { iban: HOLDER_IBAN }, name: HOLDER, product: "Käyttötili", currency: "EUR", cash_account_type: "CACC" };
const CARD = {
  uid: "u-card",
  identification_hash: "h-card",
  account_id: { other: { identification: "5225********1144", scheme_name: "CPAN" } },
  name: HOLDER,
  product: "Nordea Gold",
  currency: "EUR",
  cash_account_type: "CARD",
  credit_limit: { currency: "EUR", amount: "2000.00" },
};

function pngChunk(type: string, data: Buffer): Buffer {
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const out = Buffer.alloc(body.length + 8);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body), body.length + 4);
  return out;
}

/** A PNG of one colour, made here: the tests hold no artwork file. */
export function png(width: number, height: number, rgb: readonly [number, number, number]): Uint8Array<ArrayBuffer> {
  const head = Buffer.alloc(13);
  head.writeUInt32BE(width, 0);
  head.writeUInt32BE(height, 4);
  head.set([8, 2, 0, 0, 0], 8);
  // each row: filter byte 0, then the pixels
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 3, Buffer.from(rgb))]);
  const pixels = Buffer.concat(Array.from({ length: height }, () => row));
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return new Uint8Array(Buffer.concat([signature, pngChunk("IHDR", head), pngChunk("IDAT", deflateSync(pixels)), pngChunk("IEND", Buffer.alloc(0))]));
}

/** Where the fake bank list says its logos are. */
export const BRANDS = "https://enablebanking.com/brands/FI/";
/** The pictures the fake bank serves: a wide one, a square one and an SVG. */
export const WIDE_PNG = png(240, 60, [0, 60, 120]);
export const SQUARE_PNG = png(64, 64, [200, 30, 40]);
export const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 40"><rect width="120" height="40" fill="#0a6"/></svg>';

/**
 * A bank list with logo addresses, for `bank.answers["GET /aspsps"]`: OP has the wide picture, Danske Bank the square
 * one and S-Pankki the SVG. Aktia's address is broken (it answers 404) and Nordea has none.
 */
export const LIST_WITH_LOGOS = {
  aspsps: [
    { name: "Nordea", country: "FI" },
    { name: "OP", country: "FI", logo: `${BRANDS}op/` },
    { name: "Danske Bank", country: "FI", logo: `${BRANDS}danske/` },
    { name: "S-Pankki", country: "FI", logo: `${BRANDS}s-pankki/` },
    { name: "Aktia", country: "FI", logo: `${BRANDS}aktia/` },
  ],
};

/** An answer with a picture, as a logo address gives it. */
export const picture = (body: ConstructorParameters<typeof Response>[0], type: string, headers: Record<string, string> = {}) => new Response(body, { status: 200, headers: { "Content-Type": type, ...headers } });

/** A fake Enable Banking API with a checking account and a Nordea Gold card. */
export function mockBank() {
  const bank = {
    calls: [] as string[],
    /** Every call that is not to the API: the address and what was sent with it. A logo is the only such call. */
    pictureCalls: [] as { url: string; init: RequestInit | undefined }[],
    /** What each logo address answers. An address that is not here answers 404. */
    pictures: {
      [`${BRANDS}op/`]: () => picture(WIDE_PNG, "image/png"),
      [`${BRANDS}danske/`]: () => picture(SQUARE_PNG, "image/png"),
      [`${BRANDS}s-pankki/`]: () => picture(SVG, "image/svg+xml; charset=utf-8"),
    } as Record<string, (init?: RequestInit) => Response | Promise<Response>>,
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
    if (url.hostname !== "api.enablebanking.com") {
      bank.pictureCalls.push({ url: url.href, init });
      return bank.pictures[url.href]?.(init) ?? new Response("not found", { status: 404 });
    }
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
          accounts: [CHECKING, CARD],
        });
      // the account resource, as the session answer gives it (without its uid)
      case "GET /accounts/u-chk/details":
        return json({ ...CHECKING, uid: undefined });
      case "GET /accounts/u-card/details":
        return json({ ...CARD, uid: undefined });
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
