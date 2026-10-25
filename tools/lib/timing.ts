/**
 * Time budgets that a busy machine does not fail. A test asserts the work first (rows, pairs, an answer), then the
 * time: one warm-up run, then the best of `runs` timed runs. The time is the CPU time of the test's own process
 * (`process.cpuUsage`, user and system), not the wall clock: vitest runs each test file in a process of its own, and a
 * run that waits for a CPU while the check runs every other suite beside it costs that process nothing, while code
 * that got slower costs it the same on any machine. The best of several runs takes out a collection of garbage or a
 * cold cache. `prepare` runs before each run outside the clock (a fresh context, the rows reset, an empty instance).
 * Used by the budget tests of core (also the ones beside their code in src), the server and the web.
 */

/** CPU milliseconds of this process since `from` (a `process.cpuUsage()` reading). */
function cpuMs(from: NodeJS.CpuUsage): number {
  const d = process.cpuUsage(from);
  return (d.user + d.system) / 1000;
}

/** The fewest CPU milliseconds of `runs` timed runs after a warm-up, and the result of the last run for the test to check. */
export function bestOfSync<T>(runs: number, run: () => T, prepare: () => void = () => {}): { ms: number; result: T } {
  prepare();
  let result = run();
  let ms = Number.POSITIVE_INFINITY;
  for (let i = 0; i < runs; i++) {
    prepare();
    const start = process.cpuUsage();
    result = run();
    ms = Math.min(ms, cpuMs(start));
  }
  return { ms, result };
}

/** `bestOfSync` for work that awaits (a request, a database write); time spent waiting on nothing costs no CPU. */
export async function bestOf<T>(runs: number, run: () => Promise<T>, prepare: () => unknown = () => {}): Promise<{ ms: number; result: T }> {
  await prepare();
  let result = await run();
  let ms = Number.POSITIVE_INFINITY;
  for (let i = 0; i < runs; i++) {
    await prepare();
    const start = process.cpuUsage();
    result = await run();
    ms = Math.min(ms, cpuMs(start));
  }
  return { ms, result };
}

/** What `calibrate` reads on an idle machine: a budget stretches by how much slower it runs now (slowerNow). */
export const CALIBRATION_IDLE_MS = 80;

/** How much slower than idle the machine runs the calibration, the faster of two readings (never under 1). */
export function slowerNow(before: number): number {
  return Math.max(1, Math.min(before, calibrate()) / CALIBRATION_IDLE_MS);
}

/**
 * CPU milliseconds of a fixed piece of plain JavaScript, the best of `runs` after a warm-up: 50 000 rows made and
 * kept, grouped in a Map by a string key, each group sorted by date, all of them by amount, part of them turned into
 * JSON. It is the kind of work an analysis does, with a working set larger than a CPU cache, so what a busy machine
 * does to CPU time shows in it too: siblings on the same core, a cache shared with other suites and a lower clock make
 * the same work cost more CPU time, which `bestOf` alone does not take out. A budget test reads it beside its own runs
 * to tell a slower machine from slower code: the machine slows both, the code only its own work.
 */
export function calibrate(runs = 2): number {
  const work = () => {
    const rows: { id: string; key: string; cents: number; date: string }[] = [];
    for (let i = 0; i < 50_000; i++) {
      const day = `2026-${String((i % 12) + 1).padStart(2, "0")}-${String((i % 28) + 1).padStart(2, "0")}`;
      rows.push({ id: `r${i}`, key: `merchant-${(i * 7919) % 4999}`, cents: -((i * 31) % 10_000), date: day });
    }
    const groups = new Map<string, typeof rows>();
    for (const row of rows) groups.set(row.key, [...(groups.get(row.key) ?? []), row].slice(-40));
    for (const group of groups.values()) group.sort((a, b) => a.date.localeCompare(b.date) || a.cents - b.cents);
    rows.sort((a, b) => a.cents - b.cents || a.id.localeCompare(b.id));
    return JSON.stringify(rows.slice(0, 5_000)).length + groups.size;
  };
  return bestOfSync(runs, work).ms;
}

/**
 * The reading over its budget, as a ratio (under 1 passes): `read` returns the CPU milliseconds of the work (a `bestOf`)
 * and the budget stretches by how much slower than idle the calibration runs, the slower of one taken just before the
 * reading and one just after it, so that the load of the seconds in between is in it. A reading over budget is taken
 * again (up to `attempts`) with calibrations of its own, since a load that comes and goes is not the same in each;
 * code that got slower is over budget in every attempt.
 */
export async function budgetRatio(budgetMs: number, read: () => number | Promise<number>, attempts = 3): Promise<number> {
  let best = Number.POSITIVE_INFINITY;
  for (let attempt = 0; attempt < attempts && best >= 1; attempt++) {
    const before = calibrate();
    const ms = await read();
    const slower = Math.max(1, Math.max(before, calibrate()) / CALIBRATION_IDLE_MS);
    best = Math.min(best, ms / (budgetMs * slower));
  }
  return best;
}
