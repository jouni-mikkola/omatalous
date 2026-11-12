import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REMOVAL_NOTE, REVERTED } from "../src/services/remote-access-settle.ts";
import { OPS_ACTIONS_FOR_TEST } from "./ops-english-support.ts";
import { ACTION_LABEL_EN, opsText } from "../src/services/ops-english.ts";

const root = join(import.meta.dirname, "../../..");
// source-checked.sh holds the helper's sentences of a source update that waits for GitHub's checks (checked_source_target)
const SCRIPTS = ["scripts/ops-helper.sh", "scripts/lib/source-checked.sh", ...readdirSync(join(root, "scripts/lib")).filter((f) => /^ops-.*\.sh$/.test(f)).map((f) => `scripts/lib/${f}`)];

/** A shell string with its variables and substitutions replaced by a word. */
const filled = (s: string) => s.replace(/\$\{\w+:\+([^}]*)\}/g, "$1").replace(/\$none\b/g, NONE).replace(/\$\{[^}]*\}|\$\([^)]*\)\)?|\$[A-Za-z_][A-Za-z0-9_]*/g, "x");
const FINNISH = /[äö]|\b(ei|ja|että|ole|Syy|lokissa|muutettu|käytössä|Tarkistetaan|Luetaan)\b/;
let NONE = "";

/** The Finnish strings the helper's scripts hand to fail, SUMMARY, step_say and the *_MSG / *_ERR variables. */
function sentences(): string[] {
  const out = new Set<string>();
  for (const file of SCRIPTS) {
    NONE = file.endsWith("ops-offsite.sh") ? "Mitään ei lähetetty." : "Mitään ei muutettu.";
    for (const line of readFileSync(join(root, file), "utf8").split("\n")) {
      if (/^\s*#/.test(line)) continue;
      for (const m of line.matchAll(/(?:\bfail |access_not_made |SUMMARY\+?=|step_say |rollback_run \w+ |\b(?:DISK_MSG|GIT_MSG|POLICY_MSG|A_ERR|O_ERR)=)"((?:[^"\\]|\\.)*)"/g)) {
        let text = filled(m[0].includes("SUMMARY+=") ? `x${m[1]}` : m[1]!);
        if (/^\d+\/\d+ /.test(text)) text = text.replace(/^\d+\/\d+ /, "");
        if (text === "x" || text.trim() === "") continue;
        if (FINNISH.test(text)) out.add(text);
      }
    }
  }
  // the app's own sentences about remote access
  for (const t of [REVERTED, ...Object.values(REMOVAL_NOTE)]) if (t) out.add(t);
  return [...out];
}

describe("the helper's sentences in English", () => {
  const found = sentences();
  it("reads sentences from the scripts", () => expect(found.length).toBeGreaterThan(80));
  it("has a line for every Finnish sentence of the scripts", () => {
    const missing = found.filter((t) => opsText(t, "en") === t);
    expect(missing).toEqual([]);
  });
  it("leaves no Finnish in a translated sentence", () => {
    for (const t of found) {
      const en = opsText(t, "en");
      if (en !== t) expect(en, t).not.toMatch(FINNISH);
    }
  });
  it("fills the parts and keeps Finnish for Finnish readers", () => {
    expect(opsText("Päivitetty: 0.8.1 → 0.8.2.", "en")).toBe("Updated: 0.8.1 → 0.8.2.");
    expect(opsText("Tarkistus: 1 ongelmaa, 2 varoitusta.", "en")).toBe("Check: 1 problems, 2 warnings.");
    expect(opsText("Päivitetty: 1.0.0 → 1.0.1, mutta uusi ylläpitoapuri ei toimi (Docker ei vastaa). Päivitystä ei palautettu, koska tuoretta varmuuskopiota ei ole.", "en")).toContain("(Docker does not respond)");
    expect(opsText("Varmuuskopio otettu.", "fi")).toBe("Varmuuskopio otettu.");
    expect(opsText("Jokin outo lause.", "en")).toBe("Jokin outo lause.");
  });
  it("names every action", () => {
    expect(Object.keys(ACTION_LABEL_EN).sort()).toEqual([...OPS_ACTIONS_FOR_TEST].sort());
    for (const a of OPS_ACTIONS_FOR_TEST) expect(ACTION_LABEL_EN[a]).not.toMatch(FINNISH);
  });
});
