import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { openDatabase, takeSnapshot } from "../src/db/open.ts";
import { gateDatabase, gateEvent, notDoneNotice, requestOutcome, restoreRequestPath } from "../src/db/startup-gate.ts";
import { track } from "../src/platform/inflight.ts";
import { dangerUnderWay } from "../src/services/ops-danger.ts";
import { noticesFor, recordEvent } from "../src/services/security.ts";
import { NOW, setupApp, waitFor } from "./helpers.ts";

const PASSWORD = "aino-salasana-123";
const URL = "/api/ops/restore-latest";
const OK = { password: PASSWORD, confirm: "PALAUTA" };
const HOUR = 3600_000;

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), "talous-restore-"));
  dirs.push(d);
  return d;
};

/**
 * A request that is taken ends the process 100 ms after its answer (services/db-restore.ts). Here the signal is only
 * counted: the stop runs the real code, and the test run lives.
 */
const kill = vi.spyOn(process, "kill").mockImplementation(() => true);
afterAll(() => void kill.mockRestore());
/** The apps of the test that runs. One whose restore was taken still has its stop ahead. */
const apps: Awaited<ReturnType<typeof setupApp>>[] = [];
afterEach(async () => {
  // no stop is left to be counted by a later test, or to fire after the spy is gone
  if (apps.splice(0).some((a) => dangerUnderWay(a.s) === "restore")) await new Promise((r) => setTimeout(r, 150));
});

/** The user names in a database file: each copy of a test holds one, so a file tells which copy it is. */
function names(file: string): string[] {
  const d = new DatabaseSync(file, { readOnly: true });
  try {
    return (d.prepare("SELECT username FROM users").all() as { username: string }[]).map((r) => r.username);
  } finally {
    d.close();
  }
}

/**
 * A data folder as the container has it: `backups/` with real database copies, each `age` ms old and holding one
 * user named `body`. A name that does not end in .db, or a body that starts with "!", is written as plain text: a
 * file that is no database. `live` also writes a banking.db, for the start that follows a request.
 */
async function dataFolder(files: Record<string, { body: string; age: number }>, live?: string) {
  const dir = tmp();
  const backups = join(dir, "backups");
  mkdirSync(backups);
  const { db } = await openDatabase(join(tmp(), "template.db"));
  const write = (file: string, user: string) => {
    db.exec(`DELETE FROM users; INSERT INTO users (id, username, display_name, password_hash, role, created_at) VALUES ('u', '${user}', 'X', 'h', 'admin', '2026-01-01')`);
    db.exec(`VACUUM INTO '${file}'`);
  };
  for (const [name, f] of Object.entries(files)) {
    if (name.endsWith(".db") && !f.body.startsWith("!")) write(join(backups, name), f.body);
    else writeFileSync(join(backups, name), f.body);
    const t = new Date(NOW.getTime() - f.age);
    utimesSync(join(backups, name), t, t);
  }
  if (live) write(join(dir, "banking.db"), live);
  db.close();
  return { dir, backups, marker: restoreRequestPath(dir) };
}

/** Every file and folder under the data folder with its size and time: a refusal must leave this as it was. */
function tree(dir: string): string[] {
  return (readdirSync(dir, { recursive: true }) as string[])
    .map((p) => {
      const st = lstatSync(join(dir, p));
      return st.isFile() ? `${p} ${st.size} ${st.mtimeMs}` : `${p}/`;
    })
    .sort();
}

/** The app on a data folder. `stops.n`: how many times the process was told to end since. */
async function world(files: Record<string, { body: string; age: number }>, live?: string) {
  const folder = await dataFolder(files, live);
  const app = await setupApp({}, undefined, { backupDir: folder.backups });
  apps.push(app);
  const before0 = kill.mock.calls.length;
  const stops = {
    get n() {
      return kill.mock.calls.length - before0;
    },
  };
  const before = tree(folder.dir);
  /** Nothing on disk changed, no marker, and the server was not stopped. */
  const untouched = async (what: string) => {
    expect(tree(folder.dir), what).toEqual(before);
    expect(existsSync(folder.marker), what).toBe(false);
    // longer than the wait between the answer and the stop
    await new Promise((r) => setTimeout(r, 150));
    expect(stops.n, what).toBe(0);
  };
  const denied = async () => (await app.s.security.list({ kindPrefix: "ops_denied", limit: 20 })).map((e) => e.detail);
  return { ...app, ...folder, stops, untouched, denied };
}

/** Makes the marker one that was written at `at`: the gate reads a request's age from the file's time. */
const asked = (marker: string, at: string) => utimesSync(marker, new Date(at), new Date(at));

const THREE = {
  "auto-2026-10-07.db": { body: "two-days", age: 50 * HOUR },
  "auto-2026-10-08.db": { body: "yesterday", age: 26 * HOUR },
  "pre-update-20261009T080000.db": { body: "this-morning", age: 2 * HOUR },
};

describe("restore-latest: what the page asks first", () => {
  it("names the copy a restore would take: the newest intact one, as name, time and size", async () => {
    const { admin, backups } = await world(THREE);
    const r = await admin.call("GET", URL);
    expect(r.status).toBe(200);
    expect(r.body).toEqual({
      copy: { name: "pre-update-20261009T080000.db", at: new Date(NOW.getTime() - 2 * HOUR).toISOString(), size: lstatSync(join(backups, "pre-update-20261009T080000.db")).size, kind: "pre-update" },
      pending: false,
    });
  });

  it("skips a newer file that is no database and what an earlier restore saved", async () => {
    const { admin } = await world({ ...THREE, "auto-2026-10-09.db": { body: "!cut short", age: HOUR }, "pre-restore-20261009T093000.db": { body: "replaced", age: HOUR / 2 }, "notes.txt": { body: "no", age: 0 } });
    expect((await admin.call("GET", URL)).body.copy.name).toBe("pre-update-20261009T080000.db");
  });

  it("says none when no copy is intact, and when the process does not know its data folder", async () => {
    const { admin } = await world({ "auto-2026-10-09.db": { body: "!cut short", age: HOUR }, "pre-restore-20261009T093000.db": { body: "replaced", age: 0 } });
    expect((await admin.call("GET", URL)).body).toEqual({ copy: null, pending: false });
    const bare = await setupApp();
    expect((await bare.admin.call("GET", URL)).body).toEqual({ copy: null, pending: false });
  });
});

describe("restore-latest: the request", () => {
  it("writes the marker with the newest intact copy's name and nothing else, records it, tells the other admins and stops", async () => {
    const { admin, adminId, s, dir, marker, stops } = await world({ ...THREE, "pre-restore-20261009T093000.db": { body: "replaced", age: HOUR / 2 } });
    expect((await admin.call("POST", "/api/users", { username: "kaisa", displayName: "Kaisa", role: "admin" })).status).toBe(201);
    const r = await admin.call("POST", URL, OK);
    expect(r.status).toBe(202);
    expect(r.body).toEqual({ copy: { name: "pre-update-20261009T080000.db", at: new Date(NOW.getTime() - 2 * HOUR).toISOString(), size: expect.any(Number), kind: "pre-update" } });
    // the bytes, not the text: the name, who asked, no line end after it, no path
    expect(readFileSync(marker)).toEqual(Buffer.from(`pre-update-20261009T080000.db\n${adminId}`));
    expect(lstatSync(marker).mode & 0o777).toBe(0o600);
    expect(readdirSync(dir).sort()).toEqual([".restore-request", "backups"]);
    await waitFor(async () => stops.n === 1);
    expect((await admin.call("GET", "/api/ops/audit")).body.events[0]).toMatchObject({ username: "aino", action: "tietokannan palautus", outcome: "pyydetty (pre-update-20261009T080000.db)" });
    const kaisa = (await s.users.findForLogin("kaisa"))!;
    expect((await s.security.unseenNotices(kaisa.id)).map((e) => [e.kind, e.detail])).toEqual([["ops_notice", "Aino käynnisti tietokannan palautuksen varmuuskopiosta"]]);
    expect((await admin.call("GET", URL)).body.pending).toBe(true);
  });

  it("the start that follows restores that copy, and the copy of what it replaced is never offered", async () => {
    const { admin, adminId, dir, backups, marker } = await world(THREE, "today");
    expect((await admin.call("POST", URL, OK)).status).toBe(202);
    asked(marker, "2026-10-09T09:51:00Z");
    const gate = gateDatabase(join(dir, "banking.db"), new Date("2026-10-09T10:05:00Z"));
    expect(gate).toMatchObject({ state: "restored", cause: "requested", copy: { name: "pre-update-20261009T080000.db" }, by: adminId });
    expect(gate.notDone).toBeUndefined();
    // who asked survives: the audit line carries the id, and the notice the name
    expect(requestOutcome(gate)).toEqual({ by: adminId, detail: "tietokannan palautus: tehty (pre-update-20261009T080000.db)" });
    if (gate.state === "ok") throw new Error("restored");
    expect(gateEvent(gate, () => "9.10. klo 11.00", "Aino").detail).toBe("Aino palautti tietokannan varmuuskopiosta pre-update-20261009T080000.db (9.10. klo 11.00)");
    expect(gateEvent(gate, () => "9.10. klo 11.00").detail).toBe("Tietokanta palautettiin varmuuskopiosta pre-update-20261009T080000.db (9.10. klo 11.00)");
    expect(names(join(dir, "banking.db"))).toEqual(["this-morning"]);
    expect(existsSync(marker)).toBe(false);
    expect(names(join(backups, "pre-restore-20261009T100500.db"))).toEqual(["today"]);
    // the process that starts after it: nothing waits, and the newest copy is the same one
    const next = await setupApp({}, undefined, { backupDir: backups });
    expect((await next.admin.call("GET", URL)).body).toMatchObject({ copy: { name: "pre-update-20261009T080000.db" }, pending: false });
  });

  it("a request older than 15 minutes is dropped by the start, and the admins are told that it was not done", async () => {
    const { admin, adminId, s, dir, backups, marker } = await world(THREE, "today");
    expect((await admin.call("POST", URL, OK)).status).toBe(202);
    // the app stayed down: the start comes 16 minutes after the request
    asked(marker, "2026-10-09T09:49:00Z");
    const gate = gateDatabase(join(dir, "banking.db"), new Date("2026-10-09T10:05:00Z"));
    expect(gate).toMatchObject({ state: "ok", notDone: { name: "pre-update-20261009T080000.db", by: adminId, why: "old" } });
    expect(gate.lines.join(" ")).toContain("was not done: the request was 16 minutes old");
    expect(names(join(dir, "banking.db"))).toEqual(["today"]);
    expect(existsSync(marker)).toBe(false);
    expect(readdirSync(backups).sort()).toEqual(Object.keys(THREE).sort());
    expect(requestOutcome(gate)).toEqual({ by: adminId, detail: "tietokannan palautus: ei tehty (pre-update-20261009T080000.db), pyyntö oli vanhentunut" });
    // the notice as an admin reads it, with the time the notice adds
    await recordEvent(s, { kind: "ops_notice", userId: adminId, detail: notDoneNotice(gate.notDone!, "Aino"), notify: true });
    expect((await noticesFor(s, { id: adminId, role: "admin" })).map((n) => n.text)).toEqual([
      "Aino pyysi tietokannan palautusta varmuuskopiosta pre-update-20261009T080000.db, mutta tiedot ovat ennallaan, koska pyyntö oli vanhentunut ennen käynnistystä 9.10. klo 13.00. Jos et tiennyt siitä, kysy ylläpitäjältä.",
    ]);
  });

  it("a restore that fails at the start is returned by the gate and told, with the old data in place", async () => {
    const { admin, adminId, dir, backups, marker } = await world(THREE, "today");
    expect((await admin.call("POST", URL, OK)).status).toBe(202);
    // the copy went bad between the request and the start
    writeFileSync(join(backups, "pre-update-20261009T080000.db"), "cut short");
    asked(marker, "2026-10-09T10:04:00Z");
    const gate = gateDatabase(join(dir, "banking.db"), new Date("2026-10-09T10:05:00Z"));
    expect(gate).toMatchObject({ state: "ok", notDone: { name: "pre-update-20261009T080000.db", by: adminId, why: "failed", detail: expect.stringContaining("not a usable database") } });
    expect(names(join(dir, "banking.db"))).toEqual(["today"]);
    expect(existsSync(marker)).toBe(false);
    expect(requestOutcome(gate)?.detail).toMatch(/^tietokannan palautus: ei tehty \(pre-update-20261009T080000\.db\), .*not a usable database/);
    expect(notDoneNotice(gate.notDone!, null)).toBe("Tietokannan palautusta pyydettiin varmuuskopiosta pre-update-20261009T080000.db, mutta tiedot ovat ennallaan, koska palautus epäonnistui käynnistyksessä");
    // a marker with the name alone is still a request; one with a third line, or an id that is no id, is none
    for (const [text, state] of [["auto-2026-10-08.db", "restored"], [`auto-2026-10-08.db\n${adminId}\nx`, "ok"], ["auto-2026-10-08.db\n../x", "ok"], ["auto-2026-10-08.db\n", "ok"]] as const) {
      writeFileSync(marker, text);
      const next = gateDatabase(join(dir, "banking.db"), new Date());
      expect(next.state, JSON.stringify(text)).toBe(state);
      expect(next.notDone, JSON.stringify(text)).toBeUndefined();
      expect(existsSync(marker)).toBe(false);
    }
  });

  it("a copy written before a reset: the button takes it, a start alone never does, and pruning spares it for 14 days", async () => {
    const day = 24 * HOUR;
    const files = {
      "auto-2026-10-08.db": { body: "before", age: 30 * HOUR },
      "pre-reset-20260919T100000.db": { body: "old-reset", age: 20 * day },
      "pre-reset-20261009T093000.db": { body: "full", age: HOUR / 2 },
    };
    const { admin, dir, backups, marker } = await world(files, "emptied");
    expect((await admin.call("GET", URL)).body.copy.name).toBe("pre-reset-20261009T093000.db");

    // pruning: five later snapshots do not push the young one out; the one past its 14 days goes
    const live = new DatabaseSync(join(dir, "banking.db"));
    for (let n = 1; n <= 6; n++) takeSnapshot(live, join(dir, "banking.db"), "pre-update", new Date(NOW.getTime() + n * 1000));
    live.close();
    const kept = readdirSync(backups);
    expect(kept).toContain("pre-reset-20261009T093000.db");
    expect(kept).not.toContain("pre-reset-20260919T100000.db");
    expect(kept.filter((f) => f.startsWith("pre-update-"))).toHaveLength(5);

    // a start that finds the database damaged: the newest intact copy it may take alone would be the emptied data's
    for (const f of readdirSync(backups)) if (f.startsWith("pre-update-")) rmSync(join(backups, f));
    writeFileSync(join(dir, "banking.db"), "x".repeat(4096));
    const alone = gateDatabase(join(dir, "banking.db"), new Date());
    expect(alone).toMatchObject({ state: "damaged", waiting: null });
    expect(alone.lines.join(" ")).toContain("backups/pre-reset-20261009T093000.db was written before the data was emptied");
    expect(readFileSync(join(dir, "banking.db"), "utf8")).toBe("x".repeat(4096));
    expect(existsSync(join(dir, "damaged"))).toBe(false);

    // the admin's own request takes it
    expect((await admin.call("POST", URL, OK)).status).toBe(202);
    expect(readFileSync(marker, "utf8").split("\n")[0]).toBe("pre-reset-20261009T093000.db");
    expect(gateDatabase(join(dir, "banking.db"), new Date())).toMatchObject({ state: "restored", cause: "requested", copy: { name: "pre-reset-20261009T093000.db" } });
    expect(names(join(dir, "banking.db"))).toEqual(["full"]);
  });

  it("a wrong or missing password answers 403, records ops_denied and changes nothing", async () => {
    const { admin, untouched, denied } = await world(THREE);
    for (const password of ["väärä-salasana", "", undefined, 7]) {
      const r = await admin.call("POST", URL, { password, confirm: "PALAUTA" });
      expect(r.status, String(password)).toBe(403);
      expect(r.body.error).toBe("Salasana ei täsmää.");
    }
    expect(await denied()).toEqual(Array(4).fill("tietokannan palautus: salasana"));
    await untouched("wrong password");
  });

  it("a wrong or missing word answers 400 before the password is looked at", async () => {
    const { admin, untouched, denied } = await world(THREE);
    for (const confirm of ["palauta", "PALAUTA ", "KYLLÄ", "", undefined, true]) {
      const r = await admin.call("POST", URL, { password: PASSWORD, confirm });
      expect(r.status, String(confirm)).toBe(400);
      expect(r.body.error).toBe("Kirjoita PALAUTA vahvistukseksi.");
    }
    expect(await denied()).toEqual(Array(6).fill("tietokannan palautus: vahvistus"));
    await untouched("wrong word");
  });

  it("an extra field answers 400: no field names a file", async () => {
    const { admin, untouched } = await world(THREE);
    for (const extra of [{ file: "auto-2026-10-07.db" }, { name: "auto-2026-10-07.db" }, { copy: "../banking.db" }]) {
      const r = await admin.call("POST", URL, { ...OK, ...extra });
      expect(r.status, JSON.stringify(extra)).toBe(400);
      expect(r.body.error).toContain("Tuntematon kenttä");
    }
    expect((await admin.call("POST", URL, [OK])).status).toBe(400);
    await untouched("extra field");
  });

  it("a member gets 403 for the question and for the request", async () => {
    const { member, untouched, denied } = await world(THREE);
    const eero = await member("eero");
    expect((await eero.call("GET", URL)).status).toBe(403);
    expect((await eero.call("POST", URL, { password: "eero-uusi-salasana", confirm: "PALAUTA" })).status).toBe(403);
    expect((await (await world(THREE)).client().call("POST", URL, OK)).status).toBe(401);
    expect(await denied()).toEqual([]);
    await untouched("member");
  });

  it("answers 409 while the helper has or will take a request that changes something, as during an update", async () => {
    const { admin, adminId, s, untouched, denied, marker } = await world(THREE);
    expect(await s.ops.insert({ id: "op_0123456789abcdef", action: "update", requestedBy: adminId, at: NOW.toISOString() })).toBe(true);
    const queued = await admin.call("POST", URL, OK);
    expect(queued.status).toBe(409);
    expect(queued.body.error).toBe("Toinen toiminto on kesken.");
    expect(await s.ops.claim("op_0123456789abcdef", NOW.toISOString())).toBe(true);
    expect((await admin.call("POST", URL, OK)).status).toBe(409);
    expect(await denied()).toEqual(Array(2).fill("tietokannan palautus: toinen kesken"));
    await untouched("during an update");
    // once the update has ended, and beside a request that only reads, the restore is taken
    await s.ops.finish("op_0123456789abcdef", { status: "ok", at: NOW.toISOString(), summary: "ok" });
    expect(await s.ops.insert({ id: "op_fedcba9876543210", action: "doctor", requestedBy: adminId, at: NOW.toISOString() })).toBe(true);
    expect((await admin.call("POST", URL, OK)).status).toBe(202);
    expect(existsSync(marker)).toBe(true);
  });

  it("answers 409 while a bank fetch or other background work runs", async () => {
    const { admin, untouched, denied, marker } = await world(THREE);
    let end!: () => void;
    const fetching = track(new Promise<void>((resolve) => (end = resolve)));
    try {
      const r = await admin.call("POST", URL, OK);
      expect(r.status).toBe(409);
      expect(r.body.error).toContain("taustatyö on kesken");
      expect(await denied()).toEqual(["tietokannan palautus: taustatyö kesken"]);
      await untouched("during a fetch");
    } finally {
      end();
      await fetching;
    }
    expect((await admin.call("POST", URL, OK)).status).toBe(202);
    expect(existsSync(marker)).toBe(true);
  });

  it("with no intact copy answers 409 and writes nothing", async () => {
    const none = await world({});
    const broken = await world({ "auto-2026-10-09.db": { body: "!cut short", age: HOUR }, "pre-restore-20261009T093000.db": { body: "replaced", age: 0 } });
    for (const w of [none, broken]) {
      const r = await w.admin.call("POST", URL, OK);
      expect(r.status).toBe(409);
      expect(r.body.error).toContain("Ehjää varmuuskopiota ei löytynyt");
      expect(await w.denied()).toEqual(["tietokannan palautus: ei ehjää varmuuskopiota"]);
      await w.untouched("no intact copy");
    }
    // a process that was not told its data folder has nothing to restore either
    expect((await (await setupApp()).admin.call("POST", URL, OK)).status).toBe(409);
  });

  it("a second request while the marker exists answers 409, and the marker stays as it was", async () => {
    const { admin, marker, dir, backups, stops, denied } = await world(THREE);
    expect((await admin.call("POST", URL, OK)).status).toBe(202);
    const after = tree(dir);
    const again = await admin.call("POST", URL, OK);
    expect(again.status).toBe(409);
    expect(again.body.error).toContain("on jo pyydetty");
    expect(await denied()).toEqual(["tietokannan palautus: palautus jo pyydetty"]);
    // a reset beside it would empty a database that the start replaces
    const reset = await admin.call("POST", "/api/ops/reset", { password: PASSWORD, confirm: "TYHJENNÄ" });
    expect(reset.status).toBe(409);
    expect(reset.body.error).toBe("Toinen toiminto on kesken.");
    expect(await denied()).toContain("tietojen tyhjennys: toinen kesken");
    expect(tree(dir)).toEqual(after);
    await new Promise((r) => setTimeout(r, 250));
    expect(stops.n, "one request, one stop").toBe(1);
    expect(kill).toHaveBeenLastCalledWith(process.pid, "SIGTERM");

    // a marker another process left (a start that could not remove it): it is not written over, by any app on the folder
    writeFileSync(marker, "auto-2026-10-07.db");
    const other = await setupApp({}, undefined, { backupDir: backups });
    apps.push(other);
    expect((await other.admin.call("GET", URL)).body.pending).toBe(true);
    expect((await other.admin.call("POST", URL, OK)).status).toBe(409);
    expect(readFileSync(marker, "utf8")).toBe("auto-2026-10-07.db");
    await new Promise((r) => setTimeout(r, 150));
    expect(stops.n).toBe(1);
  });

  it("a marker that cannot be written answers 503 and leaves no marker", async () => {
    const { admin, marker, dir, untouched, denied } = await world(THREE);
    // a folder where the request is written first: the write fails as it does on a full disk
    mkdirSync(`${marker}.new`);
    const r = await admin.call("POST", URL, OK);
    expect(r.status).toBe(503);
    expect(r.body.error).toContain("Mitään ei muutettu");
    expect(await denied()).toEqual(["tietokannan palautus: pyyntöä ei voitu tallentaa"]);
    expect(existsSync(marker)).toBe(false);
    rmSync(`${marker}.new`, { recursive: true });
    await untouched("failed write");
    // the request that failed holds nothing: the next one is taken
    expect((await admin.call("POST", URL, OK)).status).toBe(202);
    expect(readdirSync(dir).sort()).toEqual([".restore-request", "backups"]);
  });
});
