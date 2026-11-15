import { join } from "node:path";
import { rmSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import type { Statfs } from "../src/db/backup-keep.ts";
import { pollOps } from "../src/services/ops.ts";
import { noticesFor } from "../src/services/security.ts";
import { NOW, setupApp, scratchDir } from "./helpers.ts";

const HOUR = 3600_000;
const HEALTH = new Set(["disk_low", "helper_silent"]);
/** The two sentences, as an admin reads them. */
const TEXT = {
  disk: (mb: number) => `Palvelimen levyllä on enää ${mb} Mt vapaata tilaa. Siivoa levy kohdassa Asetukset > Palvelin ja ylläpito.`,
  helper: "Ylläpitoapurista ei ole kuulunut vuorokauteen. Käynnistä se palvelimella uudelleen: ohje on kohdassa Asetukset > Palvelin ja ylläpito.",
};

/** A disk with this many megabytes free. */
const disk =
  (freeMb: number): Statfs =>
  () => ({ bavail: freeMb * 256, bsize: 4096 });
const ROOMY = 50_000;

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** An app with a data folder, a clock the test moves and a disk the test makes. */
async function household() {
  const dir = scratchDir("talous-health-");
  dirs.push(dir);
  const clock = { now: new Date(NOW) };
  const app = await setupApp({}, undefined, { now: () => clock.now, backupDir: join(dir, "backups") });
  /** The first admin, as the notice functions take a user. */
  const me = { id: app.adminId, role: "admin" };
  return {
    ...app,
    me,
    later: (hours: number) => void (clock.now = new Date(clock.now.getTime() + hours * HOUR)),
    notices: async (freeMb = ROOMY, user = me) => (await noticesFor(app.s, user, { statfs: disk(freeMb) })).filter((n) => HEALTH.has(n.kind)).map((n) => n.text),
  };
}

describe("the admin's notices about the disk and the helper", () => {
  it("the disk: under 1 GB free, or the reserve released", async () => {
    const h = await household();
    expect(await h.notices(2048)).toEqual([]);
    expect(await h.notices(1023)).toEqual([TEXT.disk(1023)]);
    expect(await h.notices(1024), "no reserve file and no more than 1 GB free: released").toEqual([TEXT.disk(1024)]);
    expect(await h.notices(0)).toEqual([TEXT.disk(0)]);
    expect(await h.notices(1025)).toEqual([]);
    const unreadable: Statfs = () => {
      throw new Error("ENOSYS");
    };
    expect((await noticesFor(h.s, h.me, { statfs: unreadable })).filter((n) => HEALTH.has(n.kind)), "a disk that cannot be measured is not called full").toEqual([]);
  });

  it("the helper: not seen for 24 hours, after it was seen once", async () => {
    const h = await household();
    h.later(30);
    expect(await h.notices(), "an install without the helper hears nothing").toEqual([]);
    await pollOps(h.s, { done: [] });
    h.later(24);
    expect(await h.notices()).toEqual([]);
    h.later(1);
    expect(await h.notices()).toEqual([TEXT.helper]);
    await pollOps(h.s, { done: [], dry: true });
    expect(await h.notices(), "the helper's self-test is no sign of life").toEqual([TEXT.helper]);
    await pollOps(h.s, { done: [] });
    expect(await h.notices()).toEqual([]);
  });

  it("a notice stays while its condition lasts, however long, and goes when the condition ends", async () => {
    const h = await household();

    // the disk
    expect(await h.notices(412)).toEqual([TEXT.disk(412)]);
    h.later(1);
    expect(await h.notices(300), "still low: still told").toEqual([TEXT.disk(300)]);
    h.later(1);
    expect(await h.notices(5000), "room again: gone on its own").toEqual([]);
    h.later(1);
    expect(await h.notices(700)).toEqual([TEXT.disk(700)]);

    // the helper
    await pollOps(h.s, { done: [] });
    h.later(25);
    expect(await h.notices()).toEqual([TEXT.helper]);
    h.later(24);
    expect(await h.notices(), "still silent a day later: still told").toEqual([TEXT.helper]);
    await pollOps(h.s, { done: [] });
    expect(await h.notices(), "heard again: gone on its own").toEqual([]);
  });

  it("every admin is told, a member is not, and nothing marks one as read", async () => {
    const h = await household();
    const created = await h.admin.call("POST", "/api/users", { username: "kaisa", displayName: "Kaisa", role: "admin" });
    expect(created.status).toBe(201);
    const kaisa = { id: created.body.user.id as string, role: "admin" };
    const matti = await h.member("matti");
    await pollOps(h.s, { done: [] });
    h.later(25); // the helper went quiet
    const all = [TEXT.disk(412), TEXT.helper];
    expect(await h.notices(412)).toEqual(all);
    expect(await h.notices(412, { id: matti.id, role: "member" })).toEqual([]);

    // through the routes the disk is the real one of the machine that runs the tests, so only the helper is asked for
    const sure = (body: { notices: { kind: string }[] }) => body.notices.map((n) => n.kind).filter((k) => k === "helper_silent");
    expect(sure((await h.admin.call("GET", "/api/security/notices")).body)).toEqual(["helper_silent"]);
    expect((await matti.call("GET", "/api/security/notices")).body.notices.filter((n: { kind: string }) => HEALTH.has(n.kind))).toEqual([]);
    // opening the notices marks events seen, never a state: these stay until their cause is mended
    expect((await h.admin.call("POST", "/api/security/notices/seen")).status).toBe(200);
    expect(sure((await h.admin.call("GET", "/api/security/notices")).body)).toEqual(["helper_silent"]);
    expect(await h.notices(412, kaisa), "the other admin is told the same").toEqual(all);
    expect(await h.s.settings.get(`notice_health_seen:${h.adminId}`), "no mark of a reading is stored").toBeNull();
  });
});
