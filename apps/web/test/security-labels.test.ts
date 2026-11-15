import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { KIND_LABEL } from "../src/pages/settings/Security.tsx";

/** The kinds the server records, read from its list as text: importing it would pull the server into the page's build. */
const source = readFileSync(new URL("../../server/src/services/security.ts", import.meta.url), "utf8");
const list = source.slice(source.indexOf("export const EVENT_KINDS = ["), source.indexOf("] as const"));
const kinds = [...list.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]!);

describe("Asetukset > Turvallisuus: event names", () => {
  it("every kind the server records has a Finnish label", () => {
    expect(kinds).toContain("login_ok");
    expect(kinds.filter((kind) => !KIND_LABEL[kind])).toEqual([]);
  });

  it("a rollback has one name in the list, the one the notice and the host helper use", () => {
    expect(KIND_LABEL.ops_watchdog).toBe("Edellinen versio palautettiin");
    expect(KIND_LABEL.watchdog_notice?.startsWith("Edellinen versio palautettiin")).toBe(true);
    for (const text of Object.values(KIND_LABEL)) expect(text).not.toMatch(/palautti päivityksen|päivityksen palautuksesta/);
  });
});
