/**
 * The golden files: what each source says about the demo, the life-event kit's base and fixed seeds, one file per
 * source in packages/core/test/golden/. `pnpm findings --golden` writes them, `golden.test.ts` compares. From 0.9.0's
 * second wave on, a changed golden is the review artefact: commit the diff with the code and explain each changed line.
 */
import { fileURLToPath } from "node:url";
import { bankHouseholds } from "../../packages/core/test/kit/households/index.ts";
import { kitHousehold } from "../../packages/core/test/kit/index.ts";
import { demoHousehold, type Household, seededHousehold } from "./households.ts";
import { formatStatements, SOURCE_IDS, type SourceId, type Statement, statements } from "./statements.ts";

export const GOLDEN_DIR = fileURLToPath(new URL("../../packages/core/test/golden/", import.meta.url));

/** Seeds 1 to 5 of the plain and the settled histories. */
export const GOLDEN_SEEDS = 5;

export function goldenHouseholds(): Household[] {
  const seeded = [false, true].flatMap((settled) => Array.from({ length: GOLDEN_SEEDS }, (_, i) => seededHousehold(i + 1, settled)));
  return [demoHousehold(), kitHousehold(null), ...bankHouseholds(), ...seeded];
}

/** Each source's file, from one run over the golden households. */
export function goldenTexts(): Record<SourceId, string> {
  const households = goldenHouseholds();
  const all = households.flatMap((h) => statements(h));
  return Object.fromEntries(SOURCE_IDS.map((source) => [source, textOf(source, households, all.filter((s) => s.source === source))])) as Record<SourceId, string>;
}

export function goldenText(source: SourceId): string {
  return goldenTexts()[source];
}

function textOf(source: SourceId, households: readonly Household[], list: readonly Statement[]): string {
  const head = `# ${source}: ${list.length} statements on ${households.map((h) => h.name).join(", ")}. Rewrite with pnpm findings --golden.`;
  return `${head}\n\n${list.length ? `${formatStatements(list)}\n` : ""}`;
}
