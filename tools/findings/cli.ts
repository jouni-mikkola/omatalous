/**
 * pnpm findings [--source insights|alerts|optimise|income|change|outcome|large|themes|all] [--seeds N] [--demo] [--plain] [--settled]
 *               [--event <kit event id>|all] [--loud] [--json] [--golden]
 *
 * Prints every statement the product makes about money, one block each, for the demo and the seeded households.
 * Without a household flag it runs the demo and N plain and N settled seeds (N = 5). `--event` runs the life-event
 * kit's base household and that event on it. `--golden` rewrites packages/core/test/golden/*.txt instead.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { EVENTS, kitHousehold } from "../../packages/core/test/kit/index.ts";
import { GOLDEN_DIR, goldenTexts } from "./golden.ts";
import { demoHousehold, type Household, seededHousehold } from "./households.ts";
import { formatStatements, SOURCE_IDS, type SourceId, statements } from "./statements.ts";

const USAGE = "usage: pnpm findings [--source <id>|all] [--seeds N] [--demo] [--plain] [--settled] [--event <id>|all] [--loud] [--json] [--golden]";

function fail(message: string): never {
  console.error(`${message}\n${USAGE}\nsources: ${SOURCE_IDS.join(", ")}\nevents: ${EVENTS.map((e) => e.id).join(", ")}`);
  process.exit(2);
}

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
function value(name: string): string | undefined {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  const v = args[i + 1];
  if (v === undefined || v.startsWith("--")) fail(`${name} needs a value`);
  return v;
}
const known = new Set(["--source", "--seeds", "--demo", "--plain", "--settled", "--event", "--loud", "--json", "--golden"]);
for (const [i, a] of args.entries()) if (a.startsWith("--") ? !known.has(a) : !["--source", "--seeds", "--event"].includes(args[i - 1] ?? "")) fail(`unknown argument ${a}`);

if (flag("--golden")) {
  for (const [source, text] of Object.entries(goldenTexts())) writeFileSync(join(GOLDEN_DIR, `${source}.txt`), text);
  console.log(`wrote ${SOURCE_IDS.length} files in ${GOLDEN_DIR}`);
  process.exit(0);
}

const source = value("--source") ?? "all";
if (source !== "all" && !(SOURCE_IDS as readonly string[]).includes(source)) fail(`unknown source ${source}`);
const sources: readonly SourceId[] = source === "all" ? SOURCE_IDS : [source as SourceId];
const seeds = Number(value("--seeds") ?? 5);
if (!Number.isInteger(seeds) || seeds < 0 || seeds > 200) fail("--seeds takes a whole number from 0 to 200");

const households: Household[] = [];
const event = value("--event");
if (event !== undefined) {
  if (event !== "all" && !EVENTS.some((e) => e.id === event)) fail(`unknown event ${event}`);
  households.push(kitHousehold(null), ...EVENTS.filter((e) => event === "all" || e.id === event).map((e) => kitHousehold(e)));
}
const picked = ["--demo", "--plain", "--settled"].filter(flag);
const all = picked.length === 0 && event === undefined;
if (all || flag("--demo")) households.push(demoHousehold());
for (const settled of [false, true]) {
  if (!all && !flag(settled ? "--settled" : "--plain")) continue;
  for (let seed = 1; seed <= seeds; seed++) households.push(seededHousehold(seed, settled));
}

const found = households.flatMap((h) => statements(h, sources)).filter((s) => !flag("--loud") || s.loud);
if (flag("--json")) console.log(JSON.stringify(found, null, 2));
else {
  if (found.length) console.log(formatStatements(found));
  console.log(`\n${found.length} statements, ${households.length} households: ${households.map((h) => h.name).join(", ")}`);
}
