/**
 * Remote access that locks nobody out (services/remote-access.ts and remote-access-trial.ts): a zone Cloudflare does
 * not serve and a host its certificate does not cover are refused, a turning on is taken off again unless someone
 * gets in through it, off says where the copy then answers, a call in flight keeps its request file and a refused
 * first write claims no host.
 */
import { existsSync, readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CloudflareApi } from "../src/providers/cloudflare/api.ts";
import { CloudflareClient } from "../src/providers/cloudflare/client.ts";
import { cloudflareUp } from "../src/providers/cloudflare/reconcile.ts";
import { readAccessRequest, writeAccessRequest } from "../src/services/access-request.ts";
import { settleRemoteAccess } from "../src/services/remote-access.ts";
import { hourlyTick } from "../src/services/schedule.ts";
import { waitFor } from "./helpers.ts";
import { ANNA, HOST, LAN, LIISA, PASSWORD, prepared, TUNNEL, turnedOn, world } from "./remote-access-kit.ts";

const MINUTE = 60_000;
const REVERTED = "Etäkäyttö otettiin pois käytöstä, koska kukaan ei päässyt sisään uuden osoitteen kautta 15 minuutissa.";

afterEach(() => void vi.useRealTimers());

describe("remote access: a zone and a host Cloudflare serves", () => {
  it("a zone that is not active is not listed, and a token with no active zone is not saved", async () => {
    const w = await world();
    await w.host(LAN);
    w.cf.zones.unshift({ id: "zone-new", name: "example.com", status: "pending", account: { id: "acc-main", name: "Example" } });
    const saved = await w.saveToken();
    expect(saved.status).toBe(200);
    expect(saved.body.token.zones).toEqual(["example.fi"]);
    expect(saved.body.suggestedHostname).toBe("banking-app.example.fi");

    w.cf.zones = w.cf.zones.filter((z) => z.status !== "active");
    const refused = await w.saveToken();
    expect(refused.status).toBe(400);
    expect(refused.body.error).toBe("API-tunnisteen verkkotunnus ei ole vielä käytössä Cloudflaressa. Viimeistele sen käyttöönotto Cloudflaren hallinnassa ja tallenna tunniste sitten uudelleen.");
    // the token saved before stays as it was
    expect((await w.state()).token).toMatchObject({ saved: true, zones: ["example.fi"] });
  });

  it("on is refused for a zone that stopped being active, before anything is written", async () => {
    const w = await prepared();
    w.cf.zones[0]!.status = "pending";
    const r = await w.on();
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("Verkkotunnus example.fi ei ole vielä käytössä Cloudflaressa, joten osoite ei toimisi. Viimeistele sen käyttöönotto Cloudflaren hallinnassa ja yritä uudelleen.");
    expect(w.cf.writes()).toBe(0);
    expect(existsSync(w.file)).toBe(false);
    expect((await w.state()).cloudflare.hostname).toBeNull();
  });

  it("a host two labels under its zone is 400 with the form to use, and the zone itself is fine", async () => {
    const w = await prepared();
    const r = await w.on([ANNA], "talous.koti.example.fi");
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("Osoitteessa saa olla vain yksi osa verkkotunnuksen example.fi edessä. Käytä esimerkiksi osoitetta talous-koti.example.fi.");
    expect(w.cf.writes()).toBe(0);
    expect((await w.on([ANNA], "example.fi")).status).toBe(200);
  });
});

describe("remote access: a turning on is kept only when someone gets in", () => {
  it("the first request that passes the Access check confirms it, with one write and none after", async () => {
    const w = await prepared();
    expect((await w.on()).status).toBe(200);
    await w.helper("ok", TUNNEL);
    const applied = (await w.s.ops.recent(1))[0]!.finishedAt!;
    expect((await w.state()).access).toMatchObject({ on: true, confirmed: false, revertAt: new Date(Date.parse(applied) + 15 * MINUTE).toISOString() });

    const app = w.behindAccess();
    expect((await app.visit(false)).status).toBe(403);
    expect((await w.state()).access.confirmed).toBe(false);
    expect((await app.visit(true)).status).not.toBe(403);
    expect((await w.state()).access).toMatchObject({ on: true, confirmed: true, revertAt: null });

    const writes = vi.spyOn(app.s.settings, "set");
    const reads = vi.spyOn(app.s.settings, "get");
    expect((await app.visit(true)).status).not.toBe(403);
    expect(writes).not.toHaveBeenCalled();
    expect(reads.mock.calls.filter(([key]) => key === "remote_access")).toEqual([]);

    w.later(20 * MINUTE);
    await hourlyTick(app.s);
    expect(await w.state()).toMatchObject({ pending: null, access: { on: true, confirmed: true } });
    expect(await w.events("remote_access_reverted")).toEqual([]);
  });

  it("with nobody in after 15 minutes the server takes it off itself and removes Cloudflare's side", async () => {
    const w = await prepared();
    expect((await w.on()).status).toBe(200);
    await w.helper("ok", TUNNEL);
    await w.state();
    // the revert asks for no yes, also when the copy then answers on the server alone
    await w.lanAddress("http://localhost:8080");
    const app = w.behindAccess();
    expect((await app.visit(false)).status).toBe(403);

    w.later(14 * MINUTE);
    await hourlyTick(app.s);
    expect((await w.state()).pending).toBeNull();

    w.later(2 * MINUTE);
    await hourlyTick(app.s);
    expect((await w.state()).pending).toMatchObject({ want: "lan", status: "queued" });
    expect(JSON.parse(readFileSync(w.file, "utf8"))).toEqual({ want: "lan" });
    expect(await w.events("remote_access_reverted")).toEqual([`${HOST}: kukaan ei päässyt sisään 15 minuutissa`]);
    expect(await w.events("ops_denied")).toEqual([]);
    expect((await w.s.ops.recent(1))[0]).toMatchObject({ action: "access", status: "queued", requestedBy: w.adminId });

    await w.helper("ok", LAN);
    const after = await w.state();
    expect(after.access).toMatchObject({ on: false, confirmed: false, revertAt: null });
    expect(after.last).toMatchObject({ want: "lan", hostname: HOST, outcome: "reverted", summary: REVERTED });
    await waitFor(async () => (await w.state()).cloudflare.hostname === null);
    expect([w.cf.tunnels.length, w.cf.records.length, w.cf.apps.length]).toEqual([0, 0, 0]);
    // and it stays off: nothing is queued again
    w.later(61 * MINUTE);
    await hourlyTick(w.s);
    expect((await w.state()).pending).toBeNull();
  });

  it("the app that runs behind Access looks at the clock itself, without the hourly tick", async () => {
    const w = await prepared();
    expect((await w.on()).status).toBe(200);
    await w.helper("ok", TUNNEL);
    await w.state();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    w.behindAccess();
    w.later(16 * MINUTE);
    await vi.advanceTimersByTimeAsync(16 * MINUTE);
    vi.useRealTimers();
    await waitFor(async () => (await w.record()).pending?.want === "lan");
    expect(JSON.parse(readFileSync(w.file, "utf8"))).toEqual({ want: "lan" });
  });

  it("a change of who may sign in is not on trial again", async () => {
    const w = await turnedOn();
    const app = w.behindAccess();
    expect((await app.visit(true)).status).not.toBe(403);
    expect((await w.on([LIISA])).status).toBe(200);
    await w.helper("ok", TUNNEL);
    expect((await w.state()).access).toMatchObject({ on: true, emails: [LIISA], confirmed: true, revertAt: null });
    w.later(20 * MINUTE);
    await hourlyTick(app.s);
    expect((await w.state()).pending).toBeNull();
  });
});

describe("remote access: where the copy answers after off", () => {
  it("passes the helper's address on and asks for a yes when the copy would answer on the server alone", async () => {
    const w = await turnedOn();
    // an older helper names no address, and one out of form is not passed on
    expect((await w.state()).access.afterOff).toBeNull();
    await w.lanAddress('http://localhost:8080/"><b>');
    expect((await w.state()).access.afterOff).toBeNull();
    // the form is the one the helper's state is stored by (ops-validate.ts): a port no host has is out of it
    await w.lanAddress("http://192.168.1.10:99999");
    expect((await w.state()).access.afterOff).toBeNull();
    await w.lanAddress(LAN.address);
    expect((await w.state()).access.afterOff).toBe(LAN.address);

    for (const address of ["http://localhost:8080", "http://127.0.0.1:8080", "http://[::1]:8080", "http://LOCALHOST:8080"]) {
      await w.lanAddress(address);
      expect((await w.state()).access.afterOff).toBe(address);
      const r = await w.off();
      expect(r.status).toBe(400);
      expect(r.body.error).toBe(`Kun etäkäyttö poistetaan, sovellus vastaa vain palvelimella itsellään osoitteessa ${address}. Vahvista, että tämä sopii.`);
    }
    expect((await w.off(PASSWORD, { localOnly: "kyllä" })).status).toBe(400);
    expect(existsSync(w.file)).toBe(false);
    expect(await w.s.ops.hasActiveMutating([])).toBe(false);

    const yes = await w.off(PASSWORD, { localOnly: true });
    expect(yes.status).toBe(200);
    expect(yes.body.pending).toMatchObject({ want: "lan" });
  });

  it("a copy that answers in the home network is turned off without the extra yes", async () => {
    const w = await turnedOn();
    await w.lanAddress(LAN.address);
    expect((await w.off()).status).toBe(200);
  });
});

describe("remote access: the request file of a call in flight", () => {
  it("a settle between the file and the queue leaves the file where it is", async () => {
    const w = await prepared();
    const insert = w.s.ops.insert.bind(w.s.ops);
    let seen: boolean | null = null;
    vi.spyOn(w.s.ops, "insert").mockImplementation(async (row) => {
      // the file is written and no row waits for it yet: a read of the state, the tick or the CLI settles right here
      await settleRemoteAccess(w.s);
      seen = existsSync(w.file);
      return insert(row);
    });
    const r = await w.on();
    expect(seen).toBe(true);
    expect(r.status).toBe(200);
    expect(r.body.pending).toMatchObject({ want: "tunnel", status: "queued" });
    // what `ops access` prints for the helper
    expect(readAccessRequest(w.s)).toMatchObject({ want: "tunnel", hostname: HOST });
  });

  it("another process sweeps a file nothing waits for only when it is older than two minutes", async () => {
    const w = await prepared();
    writeAccessRequest(w.s, { want: "lan" });
    await settleRemoteAccess(w.behindAccess("0".repeat(64)).s);
    expect(existsSync(w.file)).toBe(true);
    w.age();
    await settleRemoteAccess(w.s);
    expect(existsSync(w.file)).toBe(false);
  });
});

describe("remote access: whose host it is", () => {
  it("a refused first write claims nothing, and the host another copy then makes is left alone", async () => {
    const w = await prepared();
    w.cf.deny.add("POST /accounts/:id/access/identity_providers");
    expect((await w.on()).status).toBe(502);
    expect([w.cf.tunnels.length, w.cf.apps.length, w.cf.policies.length]).toEqual([0, 0, 0]);
    expect((await w.state()).cloudflare.hostname).toBeNull();

    w.cf.deny.clear();
    const other = new CloudflareApi(new CloudflareClient("other-copy-000000000000000000000000000000", w.cf.fetch));
    await cloudflareUp(other, { name: "other", hostname: HOST, emails: [ANNA], new: true }, { say: () => {}, secret: () => {} });
    w.later();
    const second = await w.on([LIISA]);
    expect(second.status).toBe(502);
    expect(second.body.error).toContain("Osoite on jo käytössä Cloudflaressa");
    expect(w.cf.policies[0]!.include).toEqual([{ email: { email: ANNA } }]);
    expect(existsSync(w.file)).toBe(false);
    expect((await w.state()).cloudflare.hostname).toBeNull();
  });

  it("a write Cloudflare never answered still claims the host: something may have been made", async () => {
    const w = await prepared();
    const send = w.cf.fetch;
    let cut = false;
    w.cf.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const answer = await send(input, init);
      if (init?.method === "POST" && String(input).endsWith("/access/identity_providers") && !cut) {
        cut = true;
        throw new TypeError("fetch failed");
      }
      return answer;
    }) as typeof fetch;
    expect((await w.on()).status).toBe(502);
    expect((await w.state()).cloudflare.hostname).toBe(HOST);
  });
});
