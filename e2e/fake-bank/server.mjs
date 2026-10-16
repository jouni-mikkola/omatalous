/**
 * A stand-in for the bank's API (Enable Banking) for the browser specs: plain Node, no dependency, on 127.0.0.1 only.
 * It answers the paths connectors/enable-banking/client.ts calls, about the household of household.mjs, and checks that
 * a request carries a bearer token and nothing more. Started by e2e/server.mjs, or by hand with `node e2e/fake-bank/server.mjs`
 * (FAKE_BANK_PORT picks the port, else a free one). It prints one line of JSON: its address and the consent host.
 */
import { createServer } from "node:http";
import { household } from "./household.mjs";

const PAGE_SIZE = 40;
/** The host of the consent page the API names. It does not exist: the browser is sent to it and a spec answers for it. */
const CONSENT_HOST = "consent.esimerkkipankki.example";

const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Helsinki" }).format(new Date());
const { accounts, transactions, balances, dollarAccount } = household(today);
/** Authorisations that were started: the consent page sends the browser back to the redirect URL given there. */
const authorizations = new Map();
let sessions = 0;
/** How POST /auth answers: "ok", "refuse-redirect" (REDIRECT_URI_NOT_ALLOWED) or "fail". PUT /fake/auth-answer changes it. */
let authAnswer = "ok";

function send(res, status, body) {
  if (body === undefined) return res.writeHead(status).end();
  return res.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify(body));
}

async function readJson(req) {
  let text = "";
  for await (const chunk of req) text += chunk;
  return text ? JSON.parse(text) : {};
}

async function handle(req, res) {
  const url = new URL(req.url ?? "/", "http://fake-bank");
  const route = `${req.method} ${url.pathname}`;

  // the consent page: the browser comes here, not the app, so there is no token to check
  const consent = /^GET \/consent\/([\w-]+)$/.exec(route);
  if (consent) {
    const authorization = authorizations.get(consent[1]);
    if (!authorization) return send(res, 404, { error: "AUTHORIZATION_NOT_FOUND" });
    // a link that asks for it (?dollars=1) also gets the account with a row in dollars; the others never see it
    authorization.dollars = url.searchParams.get("dollars") === "1";
    const back = new URL(authorization.redirectUrl);
    back.searchParams.set("code", `code-${consent[1]}`);
    back.searchParams.set("state", authorization.state);
    return res.writeHead(302, { Location: back.href }).end();
  }

  // the option for a spec that tries the redirect self-test: no token, it is the bank's side that changes
  if (route === "PUT /fake/auth-answer") {
    authAnswer = String((await readJson(req)).mode);
    return send(res, 204);
  }

  if (!/^Bearer \S+$/.test(req.headers.authorization ?? "")) return send(res, 401, { error: "UNAUTHORIZED" });
  if (route === "GET /application") return send(res, 200, { active: true });
  if (route === "GET /aspsps") {
    return send(res, 200, { aspsps: [{ name: "Nordea", country: "FI", maximum_consent_validity: 180 * 86400, psu_types: ["personal"] }] });
  }
  if (route === "POST /auth") {
    if (authAnswer === "refuse-redirect") return send(res, 422, { error: "REDIRECT_URI_NOT_ALLOWED", message: "Redirect URI not allowed" });
    if (authAnswer === "fail") return send(res, 500, { error: "FAKE_BANK_FAILED" });
    const sent = await readJson(req);
    const id = `authorization-${authorizations.size + 1}`;
    authorizations.set(id, { redirectUrl: sent.redirect_url, state: sent.state, validUntil: sent.access?.valid_until });
    return send(res, 200, { url: `https://${CONSENT_HOST}/consent/${id}`, authorization_id: id });
  }
  if (route === "POST /sessions") {
    const { code } = await readJson(req);
    const authorization = authorizations.get(String(code).replace(/^code-/, ""));
    if (!authorization) return send(res, 422, { error: "WRONG_AUTHORIZATION_CODE" });
    return send(res, 200, { session_id: `session-${++sessions}`, aspsp: { name: "Nordea", country: "FI" }, access: { valid_until: authorization.validUntil }, accounts: authorization.dollars ? [...accounts, dollarAccount] : accounts });
  }
  if (req.method === "DELETE" && url.pathname.startsWith("/sessions/")) return send(res, 204);

  const account = /^GET \/accounts\/([\w-]+)\/(details|balances|transactions)$/.exec(route);
  const uid = account?.[1] ?? "";
  if (!account || !Object.hasOwn(transactions, uid)) return send(res, 404, { error: "NOT_FOUND" });
  if (account[2] === "details") return send(res, 200, accounts.find((a) => a.uid === uid));
  if (account[2] === "balances") {
    const amount = { currency: "EUR", amount: (balances[uid] / 100).toFixed(2) };
    return send(res, 200, { balances: [{ name: "Kirjattu saldo", balance_amount: amount, balance_type: "CLBD", reference_date: today }] });
  }
  const rows = transactions[uid].filter((t) => t.booking_date >= (url.searchParams.get("date_from") ?? ""));
  const from = Number(url.searchParams.get("continuation_key")) || 0;
  const next = from + PAGE_SIZE;
  return send(res, 200, { transactions: rows.slice(from, next), continuation_key: next < rows.length ? String(next) : null });
}

const server = createServer((req, res) => {
  handle(req, res).catch(() => send(res, 500, { error: "FAKE_BANK_FAILED" }));
});
server.listen(Number(process.env.FAKE_BANK_PORT) || 0, "127.0.0.1", () => {
  console.log(JSON.stringify({ base: `http://127.0.0.1:${server.address().port}`, consentHost: CONSENT_HOST }));
});
