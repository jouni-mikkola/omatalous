/**
 * Turns the limits of the schema (platform/limits.ts) into the arguments and settings of the rate limiters and the
 * hash gate. The one place that knows which limit feeds which limiter; a limiter is never built from a number written
 * by hand (repo rule 42). `applyLimits` runs at the start and after every change of a limit, so a new value holds
 * from the next request on.
 */
import type { LimitValues } from "../platform/limits.ts";
import type { Services } from "./context.ts";

const MINUTE = 60_000;

/** The limit and window in milliseconds of each limiter, as the arguments of its constructor. */
export function limiterShapes(v: LimitValues) {
  const auth = v.authWindowMinutes * MINUTE;
  return {
    loginIp: [v.loginIp, auth],
    loginUser: [v.loginUser, auth],
    loginName: [v.loginName, auth],
    accessFailures: [v.accessFailures, auth],
    passwordChange: [v.passwordChange, auth],
    factorUser: [v.factorUser, auth],
    factorName: [v.factorName, auth],
    setup: [v.setup, auth],
    serviceToken: [v.serviceToken, auth],
    ops: [v.ops, auth],
    opsDownload: [v.opsDownload, v.opsDownloadWindowMinutes * MINUTE],
    keyTest: [v.keyTest, v.keyTestWindowMinutes * MINUTE],
  } as const satisfies Record<string, readonly [number, number]>;
}

/** Sets every limiter and the gate to the values. A window that is running keeps its end (RateLimiter.configure). */
export function applyLimits(s: Services, v: LimitValues): void {
  const shape = limiterShapes(v);
  s.loginLimiter.ip.configure(...shape.loginIp);
  s.loginLimiter.user.configure(...shape.loginUser);
  s.loginLimiter.name.configure(...shape.loginName);
  s.accessLimiter.configure(...shape.accessFailures);
  s.passwordLimiter.configure(...shape.passwordChange);
  s.factorLimiter.user.configure(...shape.factorUser);
  s.factorLimiter.name.configure(...shape.factorName);
  s.setupLimiter.configure(...shape.setup);
  s.serviceTokenLimiter.configure(...shape.serviceToken);
  s.opsLimiter.configure(...shape.ops);
  s.opsDownloadLimiter.configure(...shape.opsDownload);
  s.keyTestLimiter.configure(...shape.keyTest);
  s.hashGate.setMax(v.hashSlots);
}
