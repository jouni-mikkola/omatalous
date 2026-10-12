/**
 * What the remote access work of 0.8.7 left open: how long the last result is told, the API token while remote access
 * is on, and the helper's words in a report that comes after the timeout.
 */
import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readAccessRequest } from "../src/services/access-request.ts";
import { pollOps, reportOps } from "../src/services/ops.ts";
import { waitFor } from "./helpers.ts";
import { HOST, LAN, logged, prepared, turnedOn } from "./remote-access-kit.ts";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const TOKEN_WHILE_ON = "Ota etäkäyttö ensin pois käytöstä. Tunniste tarvitaan siihen.";

describe("remote access: the last result is told for a day", () => {
  it("a failed change is in the state at 23 hours and gone at 25, and the record keeps it", async () => {
    const w = await prepared();
    expect((await w.on()).status).toBe(200);
    await w.helper("failed", LAN);
    expect((await w.state()).last).toMatchObject({ want: "tunnel", hostname: HOST, outcome: "failed", summary: "Tunneli ei käynnistynyt." });
    w.later(23 * HOUR);
    expect((await w.state()).last).toMatchObject({ outcome: "failed" });
    w.later(2 * HOUR);
    expect((await w.state()).last).toBeNull();
    // nothing was stored to make it go
    expect((await w.record()).last).toMatchObject({ want: "tunnel", applied: false });
  });

  it("an address the server took back is told as long", async () => {
    const w = await prepared();
    const last = { want: "tunnel", hostname: HOST, applied: true, reverted: true, summary: "Valmis.", at: w.now().toISOString() };
    await w.s.settings.set("remote_access", JSON.stringify({ ...(await w.record()), last }));
    w.later(23 * HOUR);
    expect((await w.state()).last).toMatchObject({ outcome: "reverted", hostname: HOST });
    w.later(2 * HOUR);
    expect((await w.state()).last).toBeNull();
  });
});

describe("remote access: the API token while remote access is on", () => {
  it("is not removed while on (409), is replaced while on, and is removed once remote access is off", async () => {
    const w = await turnedOn();
    const refused = await w.removeToken();
    expect(refused.status).toBe(409);
    expect(refused.body.error).toBe(TOKEN_WHILE_ON);
    expect((await w.state()).token).toMatchObject({ saved: true, usable: true });
    expect(await w.events("cloudflare_token_removed")).toEqual([]);
    // the password is asked first, as for every change of the token
    expect((await w.removeToken("jokin-muu-salasana")).status).toBe(403);

    const replaced = await w.saveToken();
    expect(replaced.status).toBe(200);
    expect(await w.events("cloudflare_token_saved")).toHaveLength(2);

    expect((await w.off()).status).toBe(200);
    await w.helper("ok", LAN);
    w.later();
    // Cloudflare's side goes with the token, in the background of a read of the state
    await waitFor(async () => (await w.state()).cloudflare.hostname === null);
    expect((await w.state()).access).toMatchObject({ on: false });
    const removed = await w.removeToken();
    expect(removed.status).toBe(200);
    expect(removed.body.token).toMatchObject({ saved: false });
    expect(await w.events("cloudflare_token_removed")).toHaveLength(1);
  });
});

describe("remote access: a report that comes after the timeout", () => {
  it("holds none of the app secret, the tunnel token, the audience tag and the team's host", async () => {
    const w = await prepared();
    expect((await w.on()).status).toBe(200);
    const sent = readAccessRequest(w.s);
    if (sent?.want !== "tunnel") throw new Error("no tunnel request waits");
    const secrets = [w.s.config.appSecret!, sent.tunnelToken, sent.accessAud, sent.teamDomain];
    expect(secrets.every((v) => v.length >= 20)).toBe(true);
    const polled = await pollOps(w.s, { helper: "3", done: [] });

    // the helper is still at it when the 30 minutes are up: the change ends as failed and the request file goes
    w.later(31 * MINUTE);
    expect(await w.state()).toMatchObject({ pending: null, last: { outcome: "failed", summary: "Ei vastausta." } });
    expect(existsSync(w.file)).toBe(false);

    const [appSecret, tunnelToken, aud, team] = secrets;
    const output = [
      `STEP: 1/2 Tunneli ${tunnelToken}`,
      `STEP: 2/2 Tarkistus ${team}`,
      `TUNNEL_TOKEN=${tunnelToken}`,
      `cloudflared --token ${tunnelToken} ei käynnistynyt`,
      `CF_ACCESS_AUD=${aud}`,
      `CF_ACCESS_TEAM_DOMAIN=${team}`,
      `GET https://${team}/cdn-cgi/access/certs: aud ${aud}`,
      `avain ${appSecret}`,
      "virhe: kontti ei käynnistynyt",
    ].join("\n");
    await reportOps(w.s, { id: polled!.id, status: "failed", exit_code: 1, summary: `Tunneli ei käynnistynyt: ${tunnelToken} ${team} ${aud} ${appSecret}`, output, state: LAN }, "3");

    // the late report was stored, with the helper's own words where they hold no secret
    const row = (await w.s.ops.get(polled!.id))!;
    expect(row).toMatchObject({ status: "failed", exitCode: 1 });
    expect(row.summary).toContain("Tunneli ei käynnistynyt:");
    expect(row.output).toContain("virhe: kontti ei käynnistynyt");
    expect(JSON.parse(row.steps ?? "[]")).toHaveLength(2);

    const state = await w.state();
    const stored = [
      JSON.stringify(row),
      JSON.stringify(await w.s.ops.recent(40)),
      JSON.stringify(await w.s.security.list({ limit: 500 })),
      await w.s.settings.get("ops_state"),
      // the record without the trial, which has kept the audience tag since the turning on
      JSON.stringify({ ...(await w.record()), trial: null }),
      JSON.stringify(state),
      JSON.stringify(await w.admin.call("GET", "/api/ops/state")),
      ...w.answers,
      ...logged,
    ].join("\n");
    for (const secret of secrets) expect(stored).not.toContain(secret);
  });

  it("a report in time is cleaned of what the request file holds, and of no more", async () => {
    const w = await prepared();
    expect((await w.on()).status).toBe(200);
    const sent = readAccessRequest(w.s);
    if (sent?.want !== "tunnel") throw new Error("no tunnel request waits");
    await w.helper("failed", LAN, "Tunneli ei käynnistynyt.", `kontti banking-app-cloudflared-1 ei käynnistynyt\nTUNNEL_TOKEN=${sent.tunnelToken}\n${sent.teamDomain}\n`);
    const row = (await w.s.ops.recent(1))[0]!;
    expect(row.output).toContain("kontti banking-app-cloudflared-1 ei käynnistynyt");
    expect(row.output).not.toContain(sent.tunnelToken);
    expect(row.output).not.toContain(sent.teamDomain);
  });
});
