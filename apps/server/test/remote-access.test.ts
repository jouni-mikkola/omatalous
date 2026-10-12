/**
 * Asetukset > Palvelin > Etäkäyttö, server side (services/remote-access.ts): the routes against an in-memory
 * Cloudflare and a helper played by the test. No call leaves the process, and every name is example.fi.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { User } from "../src/db/rows.ts";
import { CloudflareApi } from "../src/providers/cloudflare/api.ts";
import { CloudflareClient } from "../src/providers/cloudflare/client.ts";
import { cloudflareUp } from "../src/providers/cloudflare/reconcile.ts";
import { writeAccessRequest } from "../src/services/access-request.ts";
import { settleRemoteAccess, turnOff, turnOn } from "../src/services/remote-access.ts";
import { AAD, TOKEN_KEY } from "../src/services/remote-access-cloudflare.ts";
import { NOW, waitFor } from "./helpers.ts";
import { ANNA, API_TOKEN, BASE, CLOUDFLARE_SAID, HOST, IN_PROGRESS, LAN, LIISA, logged, PASSWORD, PEKKA, prepared, TUNNEL, turnedOn, world } from "./remote-access-kit.ts";

describe("remote access: who may call and with what", () => {
  it("a member gets 403, a signed-out caller 401 and a form post is refused", async () => {
    const w = await prepared();
    const member = await w.member("anna");
    const before = w.cf.calls.length;
    const routes: [string, string, unknown?][] = [
      ["GET", ""],
      ["PUT", "/token", { token: API_TOKEN, password: PASSWORD }],
      ["DELETE", "/token"],
      ["POST", "/on", { hostname: HOST, emails: [ANNA], password: PASSWORD }],
      ["POST", "/off", { password: PASSWORD }],
    ];
    for (const [method, path, payload] of routes) {
      expect((await member.call(method, `${BASE}${path}`, payload)).status, `${method} ${path}`).toBe(403);
      expect((await w.client().call(method, `${BASE}${path}`, payload)).status, `${method} ${path}`).toBe(401);
      if (method !== "GET") expect((await w.admin.call(method, `${BASE}${path}`, payload, { "X-Requested-With": "form" })).body).toMatchObject({ code: "csrf" });
    }
    expect(w.cf.calls.length).toBe(before);
    expect((await w.state()).token.saved).toBe(true);
    expect(existsSync(w.file)).toBe(false);
  });

  it("extra fields and values out of form are 400 before Cloudflare hears anything", async () => {
    const w = await prepared();
    const before = w.cf.calls.length;
    const hostnames = [`https://${HOST}`, `${HOST}/polku`, `${HOST}:8443`, "127.0.0.1", "talous", "-talous.example.fi", "täti.example.fi", "", 5, null];
    const emails = [
      [],
      ANNA,
      Array.from({ length: 51 }, (_, i) => `osoite${i}@example.fi`),
      [ANNA, "ei osoite"],
      ["anna@@example.fi"],
      [`${ANNA}@example.fi`],
      ["anna@localhost"],
      ["anna@127.0.0.1"],
      ["ánna@example.fi"],
      ["anna@exämple.fi"],
      // the Kelvin sign lower-cases to a plain k: refused before anything is folded
      ["Kalle@example.fi"],
      ["anna @example.fi"],
      ["anna.@example.fi"],
      ["@example.fi"],
      [`<${ANNA}>`],
      [5],
    ];
    const bad: [string, string, unknown][] = [
      ["PUT", "/token", { token: API_TOKEN, password: PASSWORD, zone: "example.fi" }],
      ["PUT", "/token", { token: "lyhyt", password: PASSWORD }],
      ["PUT", "/token", { token: `${API_TOKEN} ${API_TOKEN}`, password: PASSWORD }],
      ["PUT", "/token", { token: 12345, password: PASSWORD }],
      ["PUT", "/token", { token: API_TOKEN, password: 5 }],
      ["POST", "/on", { hostname: HOST, emails: [ANNA], password: PASSWORD, port: 8443 }],
      ["POST", "/on", { hostname: HOST, emails: [ANNA], password: PASSWORD, new: false }],
      ["POST", "/on", { hostname: HOST, emails: [ANNA], password: { $ne: "" } }],
      ...hostnames.map((hostname): [string, string, unknown] => ["POST", "/on", { hostname, emails: [ANNA], password: PASSWORD }]),
      ...emails.map((list): [string, string, unknown] => ["POST", "/on", { hostname: HOST, emails: list, password: PASSWORD }]),
      ["POST", "/off", { password: PASSWORD, hostname: HOST }],
      ["POST", "/off", { password: [PASSWORD] }],
      ["POST", "/off", [PASSWORD]],
    ];
    for (const [method, path, payload] of bad) expect((await w.call(method, path, payload)).status, JSON.stringify(payload)).toBe(400);
    expect(w.cf.calls.length).toBe(before);
    expect(existsSync(w.file)).toBe(false);
    expect(await w.s.ops.recent(5)).toEqual([]);
  });

  it("takes as many addresses as the installer does, 50", async () => {
    const w = await prepared();
    const list = (n: number) => Array.from({ length: n }, (_, i) => `osoite${i}@example.fi`);
    const over = await w.on(list(51));
    expect(over.status).toBe(400);
    expect(over.body.error).toBe("Sähköpostiosoitteita voi olla enintään 50.");
    const full = await w.on(list(50));
    expect(full.status).toBe(200);
    expect(full.body.cloudflare.emails).toHaveLength(50);
  });

  it("says what is missing before it asks for anything: the helper, a helper new enough, the token", async () => {
    const w = await world();
    expect((await w.state()).helper).toMatchObject({ status: "off", knowsAccess: false, enableCommand: "./scripts/install.sh --ops-helper" });
    let r = await w.on();
    expect(r.status).toBe(409);
    expect(r.body.error).toBe("Ylläpitoapuri ei ole käytössä.");
    await w.host(LAN, "2");
    r = await w.on();
    expect(r.status).toBe(409);
    expect(r.body.error).toBe("Ylläpitoapurista on uudempi versio. Päivitä se palvelimella: ./scripts/install.sh --ops-helper");
    await w.host(LAN);
    expect((await w.state()).helper).toMatchObject({ status: "ok", version: "3", knowsAccess: true });
    r = await w.on();
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("Tallenna ensin Cloudflaren API-tunniste.");
    expect((await w.off()).body.error).toBe("Etäkäyttö ei ole käytössä.");
    // a copy with a domain of its own (Caddy) is not put behind a tunnel as well
    await w.saveToken();
    await w.host({ mode: "domain", address: "https://oma.example.fi" });
    r = await w.on();
    expect(r.status).toBe(400);
    expect(r.body.error).toContain("oma verkkotunnus");
    expect(w.cf.writes()).toBe(0);
    expect(existsSync(w.file)).toBe(false);
  });
});

describe("remote access: the API token", () => {
  it("is saved sealed after the password and Cloudflare's own check, and is never sent back", async () => {
    const w = await world();
    expect(await w.state()).toMatchObject({ copy: "banking-app", token: { saved: false, usable: false, savedAt: null, zones: [] }, suggestedHostname: null, access: { on: false, mode: null }, pending: null, last: null });

    const denied = await w.call("PUT", "/token", { token: API_TOKEN, password: "väärä salasana" });
    expect(denied.status).toBe(403);
    expect(denied.body.error).toBe("Salasana ei täsmää.");
    expect(await w.events("ops_denied")).toEqual(["Cloudflaren API-tunniste: salasana"]);
    expect(w.cf.calls).toEqual([]);

    const saved = await w.saveToken();
    expect(saved.status).toBe(200);
    expect(saved.body).toMatchObject({ token: { saved: true, usable: true, savedAt: NOW.toISOString(), zones: ["example.fi"] }, suggestedHostname: "banking-app.example.fi" });
    expect(w.cf.calls.map((c) => `${c.method} ${c.path}`)).toEqual(["GET /user/tokens/verify", "GET /zones"]);
    expect(new Set(w.cf.calls.map((c) => c.auth))).toEqual(new Set([`Bearer ${API_TOKEN}`]));
    // sealed for this use only
    const stored = JSON.parse((await w.s.settings.get(TOKEN_KEY))!);
    const box = (await w.s.secretBox())!;
    expect(await box.open(stored.keyEnc, AAD)).toBe(API_TOKEN);
    await expect(box.open(stored.keyEnc, "instance:enable-banking")).rejects.toThrow();
    expect(await w.events("cloudflare_token_saved")).toEqual(["verkkotunnukset: example.fi"]);

    const removed = await w.removeToken();
    expect(removed.body.token).toEqual({ saved: false, usable: false, savedAt: null, zones: [] });
    expect(await w.s.settings.get(TOKEN_KEY)).toBeNull();
    expect(await w.events("cloudflare_token_removed")).toHaveLength(1);
  });

  it("a token Cloudflare refuses, has switched off or that sees no zone is not saved", async () => {
    const w = await world();
    w.cf.unauthorized = true;
    let r = await w.saveToken();
    expect(r.status).toBe(502);
    expect(r.body.error).toBe("Cloudflare ei hyväksynyt API-tunnistetta. Se on väärä, vanhentunut tai poistettu. Tallenna uusi tunniste.");
    expect(logged).toContain("cloudflare token: token (HTTP 401)");
    w.cf.unauthorized = false;
    w.cf.tokenStatus = "disabled";
    r = await w.saveToken();
    expect(r.status).toBe(502);
    expect(r.body.error).toContain("Cloudflare ei hyväksynyt API-tunnistetta.");
    w.cf.tokenStatus = "active";
    w.cf.unreachable = true;
    r = await w.saveToken();
    expect(r.status).toBe(502);
    expect(r.body.error).toBe("Cloudflareen ei saatu yhteyttä. Yritä hetken päästä uudelleen.");
    w.cf.unreachable = false;
    w.cf.zones = [];
    r = await w.saveToken();
    expect(r.status).toBe(400);
    expect(r.body.error).toContain("ei näe yhtään verkkotunnusta");
    expect(await w.s.settings.get(TOKEN_KEY)).toBeNull();
    expect(await w.events("cloudflare_token_saved")).toEqual([]);

    // an account's own token is not a user's: it is verified under the account its zones name
    w.cf.zones = [{ id: "zone-main", name: "example.fi", status: "active", account: { id: "acc-main", name: "Example" } }];
    w.cf.deny.add("GET /user/tokens/verify");
    w.cf.tokenStatus = "expired";
    expect((await w.saveToken()).status).toBe(502);
    w.cf.tokenStatus = "active";
    expect((await w.saveToken()).status).toBe(200);
    expect(w.cf.calls.slice(-3).map((c) => c.path)).toEqual(["/user/tokens/verify", "/zones", "/accounts/acc-main/tokens/verify"]);
  });

  it("a token of another Cloudflare account does not inherit the host this copy made", async () => {
    const w = await turnedOn();
    w.cf.zones = [{ id: "zone-other", name: "example.fi", status: "active", account: { id: "acc-other", name: "Other" } }];
    w.cf.records.push({ id: "rec-theirs", zone: "zone-other", type: "CNAME", name: HOST, content: "muu.example.fi", proxied: true });
    const r = await w.on([LIISA]);
    expect(r.status).toBe(502);
    expect(r.body.error).toContain("Osoite on jo käytössä Cloudflaressa");
    expect(w.cf.policies[0]!.include).toEqual([{ email: { email: ANNA } }, { email: { email: PEKKA } }]);
  });
});

describe("remote access: on, a change and off", () => {
  it("on: Cloudflare is set up, the request waits in its file, and the helper's report puts it in force", async () => {
    const w = await prepared();
    const r = await w.on([" Anna@Example.FI ", PEKKA, ANNA], " Talous.Example.fi ");
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({
      access: { on: false, hostname: null, mode: "lan", port: 8080, emails: [], emailsKnown: false, checked: false },
      cloudflare: { hostname: HOST, emails: [ANNA, PEKKA], removal: null, note: null },
      pending: { want: "tunnel", hostname: HOST, status: "queued", requestedAt: NOW.toISOString() },
      busy: true,
    });
    expect(w.cf.tunnels).toHaveLength(1);
    expect(w.cf.records).toEqual([expect.objectContaining({ type: "CNAME", name: HOST })]);
    expect(w.cf.policies).toEqual([expect.objectContaining({ decision: "allow", include: [{ email: { email: ANNA } }, { email: { email: PEKKA } }] })]);
    expect(w.cf.apps).toEqual([expect.objectContaining({ domain: HOST, name: `Omatalous ${HOST}` })]);
    // what the helper applies: only in the file, readable by the app's user alone
    expect(JSON.parse(readFileSync(w.file, "utf8"))).toEqual({ want: "tunnel", hostname: HOST, tunnelToken: `tunnel-token-of-${w.cf.tunnels[0]!.id}-0123456789`, accessAud: w.cf.apps[0]!.aud, teamDomain: "example.cloudflareaccess.com" });
    expect(statSync(w.file).mode & 0o777).toBe(0o600);
    // the request itself names the action and carries nothing
    expect(await w.s.ops.recent(5)).toEqual([expect.objectContaining({ id: r.body.pending.requestId, action: "access", status: "queued", params: "{}" })]);

    // one change at a time, and the second one touches nothing
    const writes = w.cf.writes();
    for (const second of [await w.on([LIISA]), await w.off()]) {
      expect(second.status).toBe(409);
      expect(second.body.error).toBe(IN_PROGRESS);
    }
    expect(w.cf.writes()).toBe(writes);
    expect(JSON.parse(readFileSync(w.file, "utf8")).want).toBe("tunnel");

    await w.helper("ok", TUNNEL, "Etäkäyttö on käytössä.");
    expect(await w.state()).toMatchObject({
      access: { on: true, hostname: HOST, address: `https://${HOST}`, mode: "tunnel", emails: [ANNA, PEKKA], emailsKnown: true },
      pending: null,
      last: { want: "tunnel", hostname: HOST, outcome: "applied", summary: "Etäkäyttö on käytössä." },
      busy: false,
    });
    expect(existsSync(w.file)).toBe(false);
    // the event tells how many may sign in, not who
    expect(await w.events("remote_access_on")).toEqual([`${HOST}, sallittuja osoitteita 2`]);
  });

  it("two calls at the same moment: one is done and the other is refused", async () => {
    const w = await prepared();
    const both = await Promise.all([w.on(), w.on([LIISA])]);
    expect(both.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(both.find((r) => r.status === 409)!.body.error).toBe(IN_PROGRESS);
    expect([w.cf.tunnels.length, w.cf.policies.length, (await w.s.ops.recent(5)).length]).toEqual([1, 1, 1]);
  });

  it("a change of who may sign in goes to the same host, and another host is refused while this one is on", async () => {
    const w = await turnedOn();
    const other = await w.on([ANNA], "toinen.example.fi");
    expect(other.status).toBe(400);
    expect(other.body.error).toBe(`Etäkäyttö on jo tehty osoitteelle ${HOST}. Poista se ensin käytöstä, jos haluat vaihtaa osoitteen.`);
    const r = await w.on([PEKKA, LIISA]);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ access: { on: true, emails: [PEKKA, LIISA] }, pending: { want: "tunnel", hostname: HOST } });
    expect(w.cf.policies).toEqual([expect.objectContaining({ include: [{ email: { email: PEKKA } }, { email: { email: LIISA } }] })]);
    expect([w.cf.tunnels.length, w.cf.records.length, w.cf.apps.length]).toEqual([1, 1, 1]);
    await w.helper("ok", TUNNEL);
    expect(await w.state()).toMatchObject({ access: { on: true, emails: [PEKKA, LIISA] }, pending: null, last: { outcome: "applied" } });
    expect(existsSync(w.file)).toBe(false);
  });

  it("off: a wrong password changes nothing, the host leaves the tunnel first and Cloudflare's side goes after it", async () => {
    const w = await turnedOn();
    const writes = w.cf.writes();
    const denied = await w.off("väärä salasana");
    expect(denied.status).toBe(403);
    expect(denied.body.error).toBe("Salasana ei täsmää.");
    expect(await w.events("ops_denied")).toEqual(["etäkäyttö: salasana"]);
    expect(existsSync(w.file)).toBe(false);

    const r = await w.off();
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ access: { on: true }, pending: { want: "lan", hostname: null, status: "queued" }, cloudflare: { hostname: HOST, removal: "waiting", note: expect.stringContaining("ylläpitoapuri") } });
    expect(JSON.parse(readFileSync(w.file, "utf8"))).toEqual({ want: "lan" });
    // the admin may be coming through the tunnel: nothing of it is taken away before the host has another way in
    expect(w.cf.writes()).toBe(writes);

    w.cf.stuckTunnels = true;
    await w.helper("ok", LAN, "Etäkäyttö on pois käytöstä.");
    expect(await w.state()).toMatchObject({ access: { on: false, hostname: null, mode: "lan" }, pending: null, last: { want: "lan", outcome: "applied" } });
    expect(existsSync(w.file)).toBe(false);
    // Cloudflare still counts the tunnel's connections: the removal waits and is tried again a minute later
    await waitFor(async () => w.cf.calls.some((c) => c.method === "DELETE" && c.path.endsWith("/connections")));
    expect((await w.state()).cloudflare).toMatchObject({ hostname: HOST, removal: "waiting" });
    w.cf.stuckTunnels = false;
    w.later();
    await waitFor(async () => (await w.state()).cloudflare.hostname === null);
    expect((await w.state()).cloudflare).toEqual({ hostname: null, emails: [], removal: "removed", note: null });
    expect([w.cf.tunnels, w.cf.records, w.cf.apps, w.cf.policies]).toEqual([[], [], [], []]);
    expect((await w.events("remote_access_off")).sort()).toEqual(["asennus ei ole enää tunnelin takana", `${HOST}: poistettu Cloudflaresta`]);
    expect(await w.events("remote_access_failed")).toEqual([]);
  });

  it("off keeps Access while something this copy did not make still leads to the host, and says so", async () => {
    const w = await turnedOn();
    w.cf.records.push({ id: "rec-own", zone: "zone-main", type: "A", name: HOST, content: "192.0.2.10" });
    expect((await w.off()).status).toBe(200);
    await w.helper("ok", LAN);
    await waitFor(async () => (await w.state()).cloudflare.removal === "kept");
    expect((await w.state()).cloudflare).toMatchObject({ hostname: HOST, removal: "kept", note: expect.stringContaining("kirjautumissuojaus (Access) jätettiin päälle") });
    expect([w.cf.apps.length, w.cf.policies.length]).toEqual([1, 1]);
    expect(await w.events("remote_access_failed")).toEqual([`${HOST}: Cloudflaren puolta ei poistettu (osoitteeseen johtaa vielä muuta)`]);

    // the admin removed the record in Cloudflare: off once more finishes it at once
    w.cf.records = [];
    w.later();
    const again = await w.off();
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ pending: null, cloudflare: { hostname: null, removal: "removed", note: null } });
    expect([w.cf.apps, w.cf.policies]).toEqual([[], []]);
  });
});

describe("remote access: when the helper does not finish", () => {
  it("a failed turning on leaves the host as it was, with the helper's summary", async () => {
    const w = await prepared();
    await w.on();
    await w.helper("failed", LAN);
    expect(await w.state()).toMatchObject({
      access: { on: false, mode: "lan", emails: [] },
      cloudflare: { hostname: HOST, emails: [ANNA, PEKKA] },
      pending: null,
      last: { want: "tunnel", hostname: HOST, outcome: "failed", summary: "Tunneli ei käynnistynyt." },
    });
    expect(existsSync(w.file)).toBe(false);
    expect(await w.events("remote_access_failed")).toEqual(["käyttöönotto: Tunneli ei käynnistynyt."]);
    expect(await w.events("remote_access_on")).toEqual([]);
  });

  it("a failed turning off leaves remote access on and Cloudflare's side whole", async () => {
    const w = await turnedOn();
    const writes = w.cf.writes();
    await w.off();
    await w.helper("failed", TUNNEL, "Asetuksia ei voitu vaihtaa.");
    w.later();
    const s = await w.state();
    expect(s).toMatchObject({ access: { on: true, hostname: HOST, emails: [ANNA, PEKKA] }, cloudflare: { hostname: HOST, removal: null, note: null }, pending: null, last: { want: "lan", outcome: "failed", summary: "Asetuksia ei voitu vaihtaa." } });
    expect(existsSync(w.file)).toBe(false);
    await new Promise((done) => setTimeout(done, 30));
    expect(w.cf.writes()).toBe(writes);
    expect(await w.events("remote_access_failed")).toEqual(["käytöstä poisto: Asetuksia ei voitu vaihtaa."]);
  });

  it("a request cut short counts as applied when the host reports the new state", async () => {
    const w = await prepared();
    await w.on();
    await w.helper("failed", TUNNEL, "Yhteys katkesi kesken.");
    expect(await w.state()).toMatchObject({ access: { on: true, hostname: HOST }, last: { outcome: "applied", summary: "Yhteys katkesi kesken." } });
    expect(await w.events("remote_access_on")).toHaveLength(1);
    expect(await w.events("remote_access_failed")).toEqual([]);
  });

  it("the request file goes when the request is withdrawn, when it expires and when nothing waits for it", async () => {
    const w = await prepared();
    const first = await w.on();
    expect(existsSync(w.file)).toBe(true);
    expect((await w.admin.call("POST", `/api/ops/cancel/${first.body.pending.requestId}`, {})).status).toBe(200);
    expect(await w.state()).toMatchObject({ pending: null, last: { outcome: "failed" } });
    expect(existsSync(w.file)).toBe(false);

    w.later();
    expect((await w.on()).status).toBe(200);
    expect(existsSync(w.file)).toBe(true);
    // the helper never took it
    w.later(11 * 60_000);
    expect(await w.state()).toMatchObject({ pending: null, last: { want: "tunnel", outcome: "failed" } });
    expect(existsSync(w.file)).toBe(false);

    // a file left by a call that died half way, found by whoever settles next (the helper's report, the hourly tick)
    writeAccessRequest(w.s, { want: "lan" });
    w.age();
    await settleRemoteAccess(w.s);
    expect(existsSync(w.file)).toBe(false);
  });
});

describe("remote access: what Cloudflare refuses", () => {
  const refused = async (w: Awaited<ReturnType<typeof world>>, sentence: string) => {
    const r = await w.on();
    expect(r.status).toBe(502);
    expect(r.body).toEqual({ error: sentence });
    expect(existsSync(w.file)).toBe(false);
    expect(await w.s.ops.recent(5)).toEqual([]);
  };

  it("a hostname outside the token's zones is 400 and nothing is written", async () => {
    const w = await prepared();
    const r = await w.on([ANNA], "talous.example.org");
    expect(r.status).toBe(400);
    expect(r.body.error).toContain("Osoite ei kuulu yhteenkään verkkotunnukseen");
    expect(w.cf.writes()).toBe(0);
    expect(existsSync(w.file)).toBe(false);
  });

  it("a name someone else uses, Zero Trust off, a missing permission and no connection each get their own sentence", async () => {
    const w = await prepared();
    // the installer's --new rule: a host this copy has not made is not taken over
    w.cf.records.push({ id: "rec-other", zone: "zone-main", type: "CNAME", name: HOST, content: "muu.example.fi", proxied: true });
    await refused(w, "Osoite on jo käytössä Cloudflaressa, eikä tämä asennus ole tehnyt sitä. Valitse toinen osoite tai poista vanha Cloudflaren hallinnasta.");
    expect(logged.some((l) => /^cloudflare up: taken \(stop \d\)$/.test(l))).toBe(true);
    w.cf.records = [];
    w.cf.zeroTrust = false;
    await refused(w, "Zero Trust ei ole käytössä tällä Cloudflare-tilillä. Ota se käyttöön Cloudflaren hallinnassa (ilmainen Free-taso riittää) ja yritä uudelleen.");
    w.cf.zeroTrust = true;
    w.cf.unreachable = true;
    await refused(w, "Cloudflareen ei saatu yhteyttä. Yritä hetken päästä uudelleen.");
    w.cf.unreachable = false;
    expect(w.cf.writes()).toBe(0);
    expect((await w.state()).cloudflare.hostname).toBeNull();
    w.cf.deny.add("POST /accounts/:id/cfd_tunnel");
    await refused(w, "API-tunnisteelta puuttuu tähän tarvittava oikeus. Tarkista tunnisteen oikeudet Cloudflaresta ohjeen mukaan.");
    expect(await w.events("remote_access_failed")).toEqual(expect.arrayContaining([`${HOST}: osoite on jo käytössä`, `${HOST}: Zero Trust ei ole käytössä`, `${HOST}: Cloudflare ei vastaa`, `${HOST}: API-tunnisteen oikeus puuttuu`]));
  });

  it("a run that stops half way is this copy's to finish, and Cloudflare's own words go nowhere", async () => {
    const w = await prepared();
    w.cf.reject.set("POST /zones/:id/dns_records", `record refused, sent ${API_TOKEN}`);
    await refused(w, "Cloudflare ei hyväksynyt muutosta. Yritä hetken päästä uudelleen.");
    expect(logged).toContain("cloudflare up: other (HTTP 400)");
    // the tunnel was made, so the host is this copy's now: shown as made, with nobody let in yet
    expect(w.cf.tunnels).toHaveLength(1);
    expect((await w.state()).cloudflare).toMatchObject({ hostname: HOST, emails: [] });
    w.cf.reject.clear();
    const r = await w.on();
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ cloudflare: { hostname: HOST, emails: [ANNA, PEKKA] }, pending: { want: "tunnel" } });
    expect(w.cf.tunnels).toHaveLength(1);
  });

  it("a host the installer made is taken over only when its Access application carries the tag this app checks", async () => {
    const w = await prepared();
    const made = await cloudflareUp(new CloudflareApi(new CloudflareClient(API_TOKEN, w.cf.fetch)), { name: "banking-app", hostname: HOST, emails: [ANNA] }, { say: () => {}, secret: () => {} });
    await w.host(TUNNEL);
    const config = w.s.config as { access: unknown };
    const aino = { id: w.adminId, username: "aino" } as User;
    const from = { ip: null, userAgent: null };
    // the pair in this app's .env is another application's: the host is the installer's to change
    config.access = { aud: "0".repeat(64), teamDomain: made.teamDomain };
    await expect(turnOn(w.s, aino, { hostname: HOST, emails: [PEKKA], password: PASSWORD }, from)).rejects.toMatchObject({ status: 409, message: expect.stringContaining("asennusohjelmalla") });
    expect(w.cf.policies[0]!.include).toEqual([{ email: { email: ANNA } }]);
    config.access = { aud: made.accessAud, teamDomain: made.teamDomain };
    const changed = await turnOn(w.s, aino, { hostname: HOST, emails: [PEKKA], password: PASSWORD }, from);
    expect(changed).toMatchObject({ access: { on: true, checked: true }, cloudflare: { hostname: HOST, emails: [PEKKA] }, pending: { want: "tunnel" } });
    expect(w.cf.policies[0]!.include).toEqual([{ email: { email: PEKKA } }]);
    expect(w.cf.tunnels).toHaveLength(1);
    w.answers.push(JSON.stringify(changed));
    // and off removes what the installer made for it
    await w.helper("ok", TUNNEL);
    w.later();
    await w.s.settings.delete("remote_access");
    const off = await turnOff(w.s, aino, { password: PASSWORD }, from);
    expect(off).toMatchObject({ pending: { want: "lan" }, cloudflare: { hostname: HOST, removal: "waiting" } });
  });
});
