import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { REPORTS } from "../../../packages/core/src/reports/index.ts";
import { KIT_TODAY } from "../../../packages/core/test/kit/index.ts";
import { setupApp } from "./helpers.ts";
import { loadKit } from "./kit-load.ts";

/**
 * Three whole answers, stored: `GET /api/dashboard`, `GET /api/reports` (every report) and `GET /api/optimise`, for the
 * demo history and for the test kit's steady household, each in the own view and in the household view, each on its
 * own fixed day (the demo on the day of the server tests, the kit on `KIT_TODAY`). The answer of the app is compared
 * with a file byte for byte, so a figure that moves anywhere, in any module, shows as a changed line of one file.
 *
 * The files are `fixtures/answers/<household>/<scope>-<answer>.txt`: the answer exactly as the server wrote it, with a
 * line break and one space of indent per level added outside the strings, so one value is one line and keys keep the
 * server's order.
 *
 * To renew the files after a change that is meant to move a figure, run
 *   rm -r apps/server/test/fixtures/answers && pnpm test apps/server/test/answers-golden.test.ts
 * The run writes the files that are missing and fails once to say so; read the diff of `fixtures/answers` before
 * committing it and run the test again. The test never replaces a file that exists.
 *
 * What keeps the answers the same on every machine and day:
 * - The app's clock is a fixed day (`now` of `setupApp`), so ranges, "today" and every age are the same.
 * - `Date` itself is held on that day while the households are loaded: the demo loader stamps its balances with the
 *   real clock, and the answers read the day of a balance.
 * - Every row's id is a hash of its content, the demo and the kit are generated without a random source, and the kit's
 *   Poisson seed is fixed.
 * - `crypto.randomUUID` hands out numbered ids while a household is made, so the user's id, and the demo's account
 *   ids and series ids that are hashes of it, are the same on every run. The password hash salt and the session token
 *   are random but never reach an answer.
 *
 * No field is left out of the files: the answers are stored whole.
 */
const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "answers");

/** The answer as the server wrote it, one value a line. Outside the strings only the layout is added. */
function laidOut(text: string): string {
  let out = "";
  let depth = 0;
  let inString = false;
  const line = () => `\n${" ".repeat(depth)}`;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (inString) {
      out += ch;
      if (ch === "\\") out += text[++i];
      else if (ch === '"') inString = false;
    } else if (ch === '"') {
      inString = true;
      out += ch;
    } else if (ch === "{" || ch === "[") {
      const close = ch === "{" ? "}" : "]";
      if (text[i + 1] === close) out += ch + text[++i];
      else {
        depth++;
        out += ch + line();
      }
    } else if (ch === "}" || ch === "]") {
      depth--;
      out += line() + ch;
    } else if (ch === ",") out += ch + line();
    else if (ch === ":") out += ": ";
    else out += ch;
  }
  return `${out}\n`;
}

const SCOPES = ["own", "household"] as const;

interface Loaded {
  name: string;
  day: string;
  load: (app: Awaited<ReturnType<typeof setupApp>>) => Promise<void>;
}

const HOUSEHOLDS: readonly Loaded[] = [
  {
    name: "demo",
    day: "2026-10-09",
    load: async (app) => {
      expect((await app.admin.call("POST", "/api/demo")).status).toBe(200);
    },
  },
  { name: "kit", day: KIT_TODAY, load: loadKit },
];

async function answersOf(h: Loaded): Promise<Map<string, string>> {
  // Date is held on the household's day only while the data goes in; the app reads its own injected clock after that
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(`${h.day}T10:00:00Z`));
  // the user's id is a random UUID and the demo's account and series ids are hashes of it: number the UUIDs instead
  let issued = 0;
  vi.spyOn(globalThis.crypto, "randomUUID").mockImplementation(() => `00000000-0000-4000-8000-${String(++issued).padStart(12, "0")}`);
  try {
    const app = await setupApp({}, undefined, { now: () => new Date(`${h.day}T10:00:00Z`) });
    expect((await app.admin.call("PUT", "/api/admin/features", { optimise: true })).status).toBe(200);
    await h.load(app);
    const answers = new Map<string, string>();
    for (const scope of SCOPES) {
      for (const [name, path] of [["dashboard", "/api/dashboard"], ["reports", "/api/reports"], ["optimise", "/api/optimise"]] as const) {
        const res = await app.app.request(`http://localhost:8080${path}?scope=${scope}`, { headers: { "X-Requested-With": "fetch", Cookie: app.admin.cookie } });
        expect(res.status, `${h.name} ${scope} ${name}`).toBe(200);
        answers.set(`${scope}-${name}`, await res.text());
      }
    }
    return answers;
  } finally {
    vi.useRealTimers();
    vi.restoreAllMocks();
  }
}

describe("the three whole answers on fixed days", () => {
  for (const h of HOUSEHOLDS) {
    it(`${h.name}: dashboard, every report and optimise are the stored answers in both views`, async () => {
      const answers = await answersOf(h);
      const written: string[] = [];
      for (const [key, text] of answers) {
        const file = join(FIXTURES, h.name, `${key}.txt`);
        const shown = laidOut(text);
        if (key.endsWith("reports")) expect(Object.keys(JSON.parse(text)), key).toEqual(Object.keys(REPORTS));
        if (existsSync(file)) expect(shown, `${h.name}/${key}`).toBe(readFileSync(file, "utf8"));
        else {
          mkdirSync(dirname(file), { recursive: true });
          writeFileSync(file, shown);
          written.push(file);
        }
      }
      expect(written, "these files were missing and are written now: read their diff and run the test again").toEqual([]);
    });
  }
});
