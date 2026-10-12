/**
 * The second look at remote access (services/remote-access*.ts): what runs without a password and who can reach it,
 * the password in front of each of the four changes, the Access pair in the helper's words, the trial across a second
 * turning on and a restart, the sign-in list that would leave its own admin out, and an off asked through the tunnel
 * while the helper's last report is older than the change.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readAccessRequest, writeAccessRequest } from "../src/services/access-request.ts";
import { TOKEN_KEY } from "../src/services/remote-access-cloudflare.ts";
import { hourlyTick } from "../src/services/schedule.ts";
import { waitFor } from "./helpers.ts";
import { ANNA, API_TOKEN, HOST, LAN, LIISA, PASSWORD, PEKKA, prepared, TUNNEL, turnedOn } from "./remote-access-kit.ts";

const MINUTE = 60_000;
const NOT_SAID = "Ylläpitoapuri ei ole vielä kertonut, onko asennus tunnelin takana. Yritä hetken päästä uudelleen.";

afterEach(() => void vi.useRealTimers());

describe("remote access: the one change with no password", () => {
  const SRC = fileURLToPath(new URL("../src", import.meta.url));
  const sources = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? sources(join(dir, e.name)) : e.name.endsWith(".ts") ? [join(dir, e.name)] : []));
  const naming = (word: string) =>
    sources(SRC)
      .filter((file) => readFileSync(file, "utf8").includes(word))
      .map((file) => file.slice(SRC.length + 1).replace(/\\/g, "/"))
      .sort();

  it("is called by the trial's timer and the hourly tick, and no route or command names it", () => {
    expect(naming("queueOwnLan")).toEqual(["services/ops.ts", "services/remote-access-trial.ts"]);
    expect(naming("revertUnconfirmed")).toEqual(["services/remote-access-trial.ts", "services/schedule.ts"]);
    expect(naming("watchTrial")).toEqual(["app.ts", "services/remote-access-trial.ts"]);
  });

  it("the maintenance route does not queue `access`, with the right password either", async () => {
    const w = await turnedOn();
    const r = await w.admin.call("POST", "/api/ops/request", { action: "access", password: PASSWORD });
    expect(r.status).toBe(400);
    expect(existsSync(w.file)).toBe(false);
    expect(await w.s.ops.hasActiveMutating([])).toBe(false);
  });

  it("queues `lan` and nothing else, over whatever file is there", async () => {
    const w = await prepared();
    expect((await w.on()).status).toBe(200);
    const sent = readAccessRequest(w.s)!;
    await w.helper("ok", TUNNEL);
    await w.state();
    expect(existsSync(w.file)).toBe(false);
    // a tunnel request somebody left in the data folder
    writeAccessRequest(w.s, sent);
    w.later(16 * MINUTE);
    await hourlyTick(w.s);
    expect(JSON.parse(readFileSync(w.file, "utf8"))).toEqual({ want: "lan" });
    expect((await w.s.ops.recent(1))[0]).toMatchObject({ action: "access", status: "queued", params: "{}" });
    await w.helper("ok", LAN);
    await w.state();
    expect(existsSync(w.file)).toBe(false);
  });
});

describe("remote access: the password in front of each change", () => {
  it("a wrong one on any of the four writes nothing, and they count on the limiter maintenance requests share", async () => {
    const w = await turnedOn();
    const kept = async () => [await w.s.settings.get(TOKEN_KEY), await w.s.settings.get("remote_access"), w.cf.calls.length, existsSync(w.file), (await w.s.ops.recent(40)).length];
    const before = await kept();
    const wrong = "väärä-salasana";
    const tries = [
      () => w.call("PUT", "/token", { token: API_TOKEN.replace("cfut_", "cfat_"), password: wrong }),
      () => w.call("DELETE", "/token", { password: wrong }),
      () => w.call("POST", "/on", { hostname: HOST, emails: [LIISA], password: wrong }),
      () => w.call("POST", "/off", { password: wrong, localOnly: true }),
      () => w.call("DELETE", "/token", { password: wrong }),
    ];
    for (const attempt of tries) expect((await attempt()).status).toBe(403);
    expect(await kept()).toEqual(before);
    expect(await w.events("ops_denied")).toHaveLength(5);
    for (const attempt of tries.slice(0, 4)) expect((await attempt()).status).toBe(429);
    expect((await w.admin.call("POST", "/api/ops/request", { action: "update", password: PASSWORD })).status).toBe(429);
    expect(await kept()).toEqual(before);
  });
});

describe("remote access: the Access pair in the helper's words", () => {
  it("the audience tag and the team's host reach no summary and no stored output", async () => {
    const w = await prepared();
    expect((await w.on()).status).toBe(200);
    const sent = readAccessRequest(w.s);
    if (sent?.want !== "tunnel") throw new Error("no tunnel request waits");
    await w.helper("failed", LAN, `Tarkistus ei onnistunut: ${sent.teamDomain}`, `CF_ACCESS_AUD=${sent.accessAud}\nCF_ACCESS_TEAM_DOMAIN=${sent.teamDomain}\n`);
    const row = (await w.s.ops.recent(1))[0]!;
    expect(`${row.summary} ${row.output}`).not.toContain(sent.accessAud);
    expect(`${row.summary} ${row.output}`).not.toContain(sent.teamDomain);
    const seen = JSON.stringify([await w.state(), await w.s.security.list({ limit: 100 })]);
    expect(seen).not.toContain(sent.accessAud);
    expect(seen).not.toContain(sent.teamDomain);
  });
});

describe("remote access: the trial of a second turning on and across a restart", () => {
  it("a confirmation of the first address does not keep the next one", async () => {
    const w = await prepared();
    expect((await w.on()).status).toBe(200);
    await w.helper("ok", TUNNEL);
    const first = w.behindAccess();
    const firstAud = (await w.record()).trial.aud;
    expect((await first.visit(true)).status).not.toBe(403);
    expect((await w.state()).access.confirmed).toBe(true);

    // off and on again, all inside the first 15 minutes
    w.later();
    expect((await w.off()).status).toBe(200);
    await w.helper("ok", LAN);
    await waitFor(async () => (await w.state()).cloudflare.hostname === null);
    w.later();
    expect((await w.on()).status).toBe(200);
    await w.helper("ok", TUNNEL);
    const trial = (await w.record()).trial;
    expect(trial).toMatchObject({ confirmedAt: null });
    expect(trial.aud).not.toBe(firstAud);
    expect((await w.state()).access).toMatchObject({ on: true, confirmed: false });

    // the process of the first turning on, and a new one that still checks the first audience tag
    expect((await first.visit(true)).status).not.toBe(403);
    expect((await w.behindAccess(firstAud).visit(true)).status).not.toBe(403);
    expect((await w.state()).access.confirmed).toBe(false);
    expect((await w.behindAccess().visit(true)).status).not.toBe(403);
    expect((await w.state()).access.confirmed).toBe(true);
  });

  it("a process started in the middle of the trial takes the address off when the 15 minutes are up", async () => {
    const w = await prepared();
    expect((await w.on()).status).toBe(200);
    await w.helper("ok", TUNNEL);
    await w.state();
    w.behindAccess();
    w.later(10 * MINUTE);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    // the restart: its own start is no new beginning of the trial
    w.behindAccess();
    await vi.advanceTimersByTimeAsync(MINUTE);
    expect((await w.record()).pending).toBeNull();
    w.later(5 * MINUTE + 5000);
    await vi.advanceTimersByTimeAsync(5 * MINUTE);
    vi.useRealTimers();
    await waitFor(async () => (await w.record()).pending?.want === "lan");
    expect((await w.record()).pending).toMatchObject({ want: "lan", revert: true });
  });
});

describe("remote access: a sign-in list that would leave its own admin out", () => {
  it("is 400 when the address Access checked for this call is not on it, whatever the letter case", async () => {
    const w = await turnedOn();
    const app = w.behindAccess();
    const asked = w.cf.calls.length;
    const r = await app.call("POST", "/on", { hostname: HOST, emails: [PEKKA, LIISA], password: PASSWORD }, "Anna@Example.fi");
    expect(r.status).toBe(400);
    expect(r.body.error).toBe(`Listalta puuttuu osoite ${ANNA}, jolla olet nyt kirjautunut. Lisää se, muuten et pääse enää sisään.`);
    expect(w.cf.calls.length).toBe(asked);
    expect(existsSync(w.file)).toBe(false);
    expect(await w.events("ops_denied")).toEqual([]);

    const kept = await app.call("POST", "/on", { hostname: HOST, emails: [LIISA, "ANNA@example.fi"], password: PASSWORD }, "Anna@Example.fi");
    expect(kept.status).toBe(200);
    expect(kept.body.cloudflare.emails).toEqual([LIISA, ANNA]);
  });

  it("a service token and a call from the home network are not refused", async () => {
    const w = await turnedOn();
    // Access checked no address for this call
    const service = await w.behindAccess().call("POST", "/on", { hostname: HOST, emails: [PEKKA], password: PASSWORD });
    expect(service.status).toBe(200);
    await w.helper("ok", TUNNEL);
    w.later();
    expect((await w.on([LIISA])).status).toBe(200);
  });
});

describe("remote access: off asked through the tunnel", () => {
  it("leaves Cloudflare's side alone while the helper's last report still says the home network", async () => {
    const w = await prepared();
    expect((await w.on()).status).toBe(200);
    // cut short: the host went behind the tunnel, and the last report of it is from before
    await w.helper("failed", LAN, "Yhteys katkesi kesken.");
    w.later();
    const app = w.behindAccess();
    const writes = w.cf.writes();
    const early = await app.call("POST", "/off", { password: PASSWORD }, ANNA);
    expect(early.status).toBe(409);
    expect(early.body.error).toBe(NOT_SAID);
    expect(w.cf.writes()).toBe(writes);
    expect((await w.record()).hostname).toBe(HOST);

    await w.host(TUNNEL);
    const off = await app.call("POST", "/off", { password: PASSWORD }, ANNA);
    expect(off.status).toBe(200);
    expect(off.body).toMatchObject({ pending: { want: "lan" }, cloudflare: { hostname: HOST, removal: "waiting" } });
    expect(w.cf.writes()).toBe(writes);
  });
});
