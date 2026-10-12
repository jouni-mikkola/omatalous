/**
 * Who ends a remote access change when no page is open (the helper's report through the CLI, a withdrawal, the hourly
 * tick), that two processes end it once, and what a change leaves behind when the helper is late, repeats the tunnel
 * token or the saved API token no longer opens.
 */
import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { runOpsCli } from "../src/cli-ops.ts";
import { SecretBox } from "../src/security/secretbox.ts";
import { readAccessRequest } from "../src/services/access-request.ts";
import { pollOps, reportOps } from "../src/services/ops.ts";
import { settleRemoteAccess } from "../src/services/remote-access.ts";
import { AAD, TOKEN_KEY } from "../src/services/remote-access-cloudflare.ts";
import { hourlyTick } from "../src/services/schedule.ts";
import { waitFor } from "./helpers.ts";
import { API_TOKEN, HOST, LAN, prepared, TUNNEL, turnedOn } from "./remote-access-kit.ts";

const MINUTE = 60_000;
const cloudflareSide = (w: Awaited<ReturnType<typeof prepared>>) => [w.cf.tunnels.length, w.cf.records.length, w.cf.apps.length];

describe("remote access: a change ends without a page", () => {
  it("the helper's report through the CLI ends it: the file is gone and the outcome is recorded once", async () => {
    const w = await prepared();
    expect((await w.on()).status).toBe(200);
    const polled = await pollOps(w.s, { helper: "3", done: [] });
    const report = { id: polled!.id, status: "ok", exit_code: 0, summary: "Etäkäyttö on päivitetty.", output: "", state: TUNNEL };
    expect(await runOpsCli(w.s, ["report", "--helper", "3"], async () => JSON.stringify(report))).toBe(0);
    expect(existsSync(w.file)).toBe(false);
    expect((await w.record()).pending).toBeNull();
    expect(await w.events("remote_access_on")).toHaveLength(1);
  });

  it("a withdrawal deletes the file before anyone reads the state", async () => {
    const w = await prepared();
    const r = await w.on();
    expect(existsSync(w.file)).toBe(true);
    expect((await w.admin.call("POST", `/api/ops/cancel/${r.body.pending.requestId}`, {})).status).toBe(200);
    expect(existsSync(w.file)).toBe(false);
  });

  it("the hourly tick removes Cloudflare's side after an off nobody watched, and ends an expired request", async () => {
    const w = await turnedOn();
    expect((await w.off()).status).toBe(200);
    await w.helper("ok", LAN);
    expect(cloudflareSide(w)).toEqual([1, 1, 1]);
    await hourlyTick(w.s);
    await waitFor(async () => w.cf.apps.length === 0);
    expect(cloudflareSide(w)).toEqual([0, 0, 0]);

    const late = await prepared();
    expect((await late.on()).status).toBe(200);
    late.later(11 * MINUTE);
    await hourlyTick(late.s);
    expect(existsSync(late.file)).toBe(false);
    expect((await late.record()).pending).toBeNull();
  });

  it("two processes that end the same change record one outcome", async () => {
    const w = await prepared();
    expect((await w.on()).status).toBe(200);
    await w.helper("ok", TUNNEL);
    const other = w.behindAccess().s;
    await Promise.all([settleRemoteAccess(w.s), settleRemoteAccess(other), settleRemoteAccess(other), settleRemoteAccess(w.s)]);
    expect(await w.events("remote_access_on")).toHaveLength(1);
    expect((await w.record()).pending).toBeNull();
  });
});

describe("remote access: a helper that is late or says too much", () => {
  it("a withdrawn off leaves Cloudflare's side whole and waits for nothing", async () => {
    const w = await turnedOn();
    const writes = w.cf.writes();
    const off = await w.off();
    expect(off.body.cloudflare.removal).toBe("waiting");
    expect((await w.admin.call("POST", `/api/ops/cancel/${off.body.pending.requestId}`, {})).status).toBe(200);
    expect(await w.state()).toMatchObject({ pending: null, access: { on: true }, cloudflare: { hostname: HOST, removal: null } });
    expect(w.cf.writes()).toBe(writes);
  });

  it("a request that timed out and reports ok afterwards: the state follows the host, and off again removes Cloudflare's side", async () => {
    const w = await turnedOn();
    expect((await w.off()).status).toBe(200);
    const polled = await pollOps(w.s, { helper: "3", done: [] });
    w.later(31 * MINUTE);
    expect(await w.state()).toMatchObject({ pending: null, access: { on: true }, last: { want: "lan", outcome: "failed" }, cloudflare: { removal: null } });
    expect(existsSync(w.file)).toBe(false);

    await reportOps(w.s, { id: polled!.id, status: "ok", exit_code: 0, summary: "Etäkäyttö on päivitetty.", output: "", state: LAN }, "3");
    expect(await w.state()).toMatchObject({ pending: null, access: { on: false, hostname: null }, last: { want: "lan", outcome: "applied" } });
    expect(cloudflareSide(w)).toEqual([1, 1, 1]);
    expect((await w.off()).status).toBe(200);
    expect(cloudflareSide(w)).toEqual([0, 0, 0]);
  });

  it("the tunnel token the helper repeats reaches no summary, no stored output and no event", async () => {
    const w = await prepared();
    expect((await w.on()).status).toBe(200);
    const sent = readAccessRequest(w.s);
    const token = sent?.want === "tunnel" ? sent.tunnelToken : "";
    expect(token).toContain("tunnel-token-of-");
    await w.helper("failed", LAN, `Tunneli ei käynnistynyt: ${token}`, `TUNNEL_TOKEN=${token}\nvirhe\n`);
    // read before any settle: what Asetukset > Ylläpito would show
    const row = (await w.s.ops.recent(1))[0]!;
    expect(`${row.summary} ${row.output}`).not.toContain(token);
    expect(row.summary).toContain("Tunneli ei käynnistynyt");
    const state = await w.state();
    expect(state.last.summary).not.toContain(token);
    expect(JSON.stringify(await w.s.security.list({ limit: 100 }))).not.toContain(token);
  });

  it("a saved token that no longer opens: on asks to save it again, and a removal ends as failed", async () => {
    const w = await turnedOn();
    const stored = JSON.parse((await w.s.settings.get(TOKEN_KEY))!);
    const other = await SecretBox.fromSecret("another-copys-secret-0123456789-abcdefghijklmnop");
    await w.s.settings.set(TOKEN_KEY, JSON.stringify({ ...stored, keyEnc: await other.seal(API_TOKEN, AAD) }));
    expect((await w.state()).token).toMatchObject({ saved: true, usable: false });
    const on = await w.on();
    expect(on.status).toBe(400);
    expect(on.body.error).toBe("Tallenna Cloudflaren API-tunniste uudelleen.");

    expect((await w.off()).status).toBe(200);
    await w.helper("ok", LAN);
    await waitFor(async () => (await w.state()).cloudflare.removal === "failed");
    expect(cloudflareSide(w)).toEqual([1, 1, 1]);
  });

  it("a token that no longer sees the zone: the event says so in its own words", async () => {
    const w = await turnedOn();
    expect((await w.off()).status).toBe(200);
    await w.helper("ok", LAN);
    w.cf.zones = [];
    await waitFor(async () => (await w.state()).cloudflare.removal === "failed");
    expect(await w.events("remote_access_failed")).toContain(`${HOST}: Cloudflaren puolta ei poistettu (osoite ei kuulu tunnisteen verkkotunnuksiin)`);
  });
});
