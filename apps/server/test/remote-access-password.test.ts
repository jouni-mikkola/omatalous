/**
 * The admin's password in front of every remote access change (one check, shared with maintenance requests), what the
 * queue refuses after Cloudflare was asked, and the answers for a host this page did not make.
 */
import { existsSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { CloudflareApi } from "../src/providers/cloudflare/api.ts";
import { CloudflareClient } from "../src/providers/cloudflare/client.ts";
import { cloudflareUp } from "../src/providers/cloudflare/reconcile.ts";
import { waitFor } from "./helpers.ts";
import { ANNA, BASE, HOST, IN_PROGRESS, LAN, PASSWORD, prepared, TUNNEL, turnedOn, world } from "./remote-access-kit.ts";

describe("remote access: the password", () => {
  it("on with a wrong password changes nothing, and the limiter is the one maintenance requests share", async () => {
    const w = await prepared();
    const asked = w.cf.calls.length;
    const wrong = () => w.call("POST", "/on", { hostname: HOST, emails: [ANNA], password: "väärä-salasana" });
    const first = await wrong();
    expect(first.status).toBe(403);
    expect(first.body.error).toBe("Salasana ei täsmää.");
    expect(await w.events("ops_denied")).toEqual(["etäkäyttö: salasana"]);
    expect(w.cf.calls.length).toBe(asked);
    expect(existsSync(w.file)).toBe(false);
    expect(await w.s.ops.recent(5)).toEqual([]);

    for (let i = 0; i < 4; i++) expect((await wrong()).status).toBe(403);
    const limited = await wrong();
    expect(limited.status).toBe(429);
    expect(Number(limited.res.headers.get("retry-after"))).toBeGreaterThan(0);
    const maintenance = await w.admin.call("POST", "/api/ops/request", { action: "update", password: PASSWORD });
    expect(maintenance.status).toBe(429);
    expect(w.cf.calls.length).toBe(asked);
  });

  it("the password is hashed once a call: a full hash gate refuses before Cloudflare is asked, never after", async () => {
    const w = await prepared();
    const gate = vi.spyOn(w.s.hashGate, "tryEnter");
    expect((await w.on()).status).toBe(200);
    expect(gate).toHaveBeenCalledTimes(1);

    const busy = await prepared();
    while (busy.s.hashGate.tryEnter());
    const r = await busy.on();
    expect(r.status).toBe(429);
    expect(r.body.error).toBe("Palvelin on kiireinen. Yritä hetken päästä uudelleen.");
    expect(busy.cf.writes()).toBe(0);
  });

  it("what the queue would refuse is asked before Cloudflare, in the queue's own words and with no event", async () => {
    const w = await prepared();
    expect((await w.admin.call("POST", "/api/ops/request", { action: "update", password: PASSWORD })).status).toBe(200);
    const busy = await w.on();
    expect(busy.status).toBe(409);
    expect(busy.body.error).toBe("Toinen toiminto on kesken.");
    expect(w.cf.writes()).toBe(0);

    // the hour's cap counts the read-only requests too
    const full = await prepared();
    for (let i = 0; i < 20; i++) expect(await full.s.ops.insert({ id: `op_${String(i).padStart(16, "0")}`, action: "check-update", requestedBy: full.adminId, at: full.now().toISOString() })).toBe(true);
    const capped = await full.on();
    expect(capped.status).toBe(429);
    expect(capped.body.error).toBe("Liian monta pyyntöä tunnissa. Yritä myöhemmin.");
    expect(Number(capped.res.headers.get("retry-after"))).toBe(3600);
    expect(full.cf.writes()).toBe(0);
    expect(existsSync(full.file)).toBe(false);
    expect(await full.events("ops_denied")).toEqual([]);
  });

  it("a refusal by the queue after the file was written takes the file away", async () => {
    const w = await prepared();
    vi.spyOn(w.s.ops, "insert").mockResolvedValue(false);
    const r = await w.on();
    expect(r.status).toBe(409);
    expect(r.body.error).toBe("Toinen toiminto on kesken.");
    expect(existsSync(w.file)).toBe(false);
    expect((await w.state()).pending).toBeNull();
  });

  it("removing the token asks for the password and waits for a change that is under way", async () => {
    const w = await turnedOn();
    expect((await w.removeToken("väärä-salasana")).status).toBe(403);
    expect((await w.call("DELETE", "/token", {})).status).toBe(403);
    expect((await w.call("DELETE", "/token", { password: PASSWORD, extra: 1 })).status).toBe(400);
    expect((await w.state()).token.saved).toBe(true);

    expect((await w.off()).status).toBe(200);
    const pending = await w.removeToken();
    expect(pending.status).toBe(409);
    expect(pending.body.error).toBe(IN_PROGRESS);
    w.cf.stuckTunnels = true;
    await w.helper("ok", LAN);
    // the helper is done, and Cloudflare's side still waits to be removed with this token
    expect((await w.state()).cloudflare.removal).toBe("waiting");
    expect((await w.removeToken()).status).toBe(409);
    expect((await w.state()).token.saved).toBe(true);

    w.cf.stuckTunnels = false;
    w.later();
    await waitFor(async () => (await w.state()).cloudflare.hostname === null);
    const removed = await w.removeToken();
    expect(removed.status).toBe(200);
    expect(removed.body.token).toMatchObject({ saved: false, usable: false });
    expect(await w.events("cloudflare_token_removed")).toHaveLength(1);
  });
});

describe("remote access: a host this page did not make", () => {
  /** The installer put the copy behind the tunnel, and its `.env` has no pair for the app to check. */
  async function installed() {
    const w = await world();
    await w.host(TUNNEL);
    const installer = new CloudflareApi(new CloudflareClient("installer-0000000000000000000000000000000", w.cf.fetch));
    await cloudflareUp(installer, { name: "banking-app", hostname: HOST, emails: [ANNA], new: true }, { say: () => {}, secret: () => {} });
    expect((await w.saveToken()).status).toBe(200);
    return w;
  }

  it("on says the installer made it, and changes nothing there", async () => {
    const w = await installed();
    const writes = w.cf.writes();
    const r = await w.on();
    expect(r.status).toBe(409);
    expect(r.body.error).toBe("Tämän asennuksen etäkäyttö on tehty palvelimella asennusohjelmalla, eikä sitä voi muuttaa täältä. Muuta sitä palvelimella asennusohjelmalla (./scripts/install.sh).");
    expect(w.cf.writes()).toBe(writes);
  });

  it("off takes the copy out of the tunnel and says that Cloudflare's side stays", async () => {
    const w = await installed();
    const off = await w.off();
    expect(off.status).toBe(200);
    const note = "Tämän osoitteen on tehnyt Cloudflareen palvelimen asennusohjelma, joten tunneli, DNS-tietue ja kirjautumissuojaus (Access) jäivät sinne. Poista ne Cloudflaren hallinnasta tai palvelimen asennusohjelmalla.";
    expect(off.body.cloudflare).toMatchObject({ hostname: null, removal: "installer", note });
    await w.helper("ok", LAN);
    expect((await w.state()).cloudflare).toMatchObject({ hostname: null, removal: "installer", note });
    expect(w.cf.tunnels).toHaveLength(1);
  });

  it("off waits for the helper's word on how the host runs before it touches Cloudflare", async () => {
    const w = await world();
    await w.host({});
    expect((await w.saveToken()).status).toBe(200);
    expect((await w.on()).status).toBe(200);
    await w.helper("failed", {});
    w.later();
    const writes = w.cf.writes();
    const r = await w.off();
    expect(r.status).toBe(409);
    expect(r.body.error).toBe("Ylläpitoapuri ei ole vielä kertonut, onko asennus tunnelin takana. Yritä hetken päästä uudelleen.");
    expect(w.cf.writes()).toBe(writes);
  });

  it("the suggested host never ends in a hyphen", async () => {
    // a copy's name is cut at 60 characters (platform/config.ts), here right after the underscore
    const w = await world({ INSTANCE_NAME: `${"a".repeat(59)}_koti` });
    await w.host(LAN);
    expect((await w.saveToken()).body.suggestedHostname).toBe(`${"a".repeat(59)}.example.fi`);
  });

  it("the routes read each body once and name an unknown field", async () => {
    const w = await prepared();
    const r = await w.admin.call("POST", `${BASE}/off`, { password: PASSWORD, hostname: HOST });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("Tuntematon kenttä: hostname");
  });
});
