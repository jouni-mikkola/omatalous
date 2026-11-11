/**
 * The version rule of an add-on module's manifest (docs/MODULES.md): MAJOR.MINOR.PATCH, and a range of comparators
 * `>=`, `>`, `<=`, `<`, `=`, `^`, `~` or a bare version, separated by spaces, alternatives joined by `||`. Anything
 * else is no range, and a bundle with no range is refused.
 */
type Version = readonly [number, number, number];

const VERSION = /^(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})$/;
const COMPARATOR = /^(>=|<=|>|<|=|\^|~)?(\S+)$/;

export function parseVersion(text: string): Version | null {
  const m = VERSION.exec(text);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

export function compareVersions(a: Version, b: Version): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

/** The running app's version without a prerelease or build part, so `0.9.0-rc.1` meets `>=0.9.0`. */
function coreVersion(text: string): Version | null {
  return parseVersion(text.split(/[-+]/)[0] ?? "");
}

type Test = (v: Version) => boolean;

function comparator(text: string): Test | null {
  const m = COMPARATOR.exec(text);
  if (!m) return null;
  const v = parseVersion(m[2]!);
  if (!v) return null;
  const cmp = (x: Version) => compareVersions(x, v);
  switch (m[1]) {
    case ">=":
      return (x) => cmp(x) >= 0;
    case ">":
      return (x) => cmp(x) > 0;
    case "<=":
      return (x) => cmp(x) <= 0;
    case "<":
      return (x) => cmp(x) < 0;
    case "^": {
      // the npm caret: below the next version that changes the leftmost non-zero part
      const upper: Version = v[0] > 0 ? [v[0] + 1, 0, 0] : v[1] > 0 ? [0, v[1] + 1, 0] : [0, 0, v[2] + 1];
      return (x) => cmp(x) >= 0 && compareVersions(x, upper) < 0;
    }
    case "~": {
      const upper: Version = [v[0], v[1] + 1, 0];
      return (x) => cmp(x) >= 0 && compareVersions(x, upper) < 0;
    }
    default:
      return (x) => cmp(x) === 0;
  }
}

/** The range as a test, or null when it is not one this rule knows. */
export function parseRange(range: string): Test | null {
  if (range.length === 0 || range.length > 200) return null;
  const alternatives: Test[][] = [];
  for (const part of range.split("||")) {
    const words = part.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) return null;
    const tests = words.map(comparator);
    if (tests.some((t) => t === null)) return null;
    alternatives.push(tests as Test[]);
  }
  return (v) => alternatives.some((all) => all.every((t) => t(v)));
}

/** Whether the running version `app` is inside `range`. False for anything that does not parse. */
export function satisfies(app: string, range: string): boolean {
  const v = coreVersion(app);
  const test = parseRange(range);
  return !!v && !!test && test(v);
}
