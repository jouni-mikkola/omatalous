// @ts-check
/**
 * Preloaded into the server of an e2e run (`node --import`, e2e/server.mjs) when E2E_TODAY (YYYY-MM-DD) is set: the server's
 * clock starts at 10:00 UTC of that day and runs on from there. Decision: what a spec that depends on the day of the month
 * (the demo household's bills are dated from today) sees, whatever day the run is on. `new Date()` and `Date.now()` move by
 * the same amount; a date given to `new Date(...)` is that date.
 */
const day = process.env.E2E_TODAY;
if (day) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error(`E2E_TODAY is "${day}": write it as YYYY-MM-DD.`);
  const Real = Date;
  const shift = Real.parse(`${day}T10:00:00Z`) - Real.now();
  globalThis.Date = new Proxy(Real, {
    construct: (target, args, newTarget) => Reflect.construct(target, args.length ? args : [Real.now() + shift], newTarget),
    get: (target, name, receiver) => (name === "now" ? () => Real.now() + shift : Reflect.get(target, name, receiver)),
  });
}
