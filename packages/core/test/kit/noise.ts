/**
 * Noise models for steady households, on the seeded `rng` of gen.ts: visit counts that are Poisson or over-dispersed
 * (a gamma-Poisson mixture, so some months are much busier than others) and tickets with a normal or a heavy
 * log-normal spread. A steady household has no change in its habits, so a detector that compares two windows and
 * fires on it is a false finding (K-efficiency item 9).
 */
import { rng } from "../gen.ts";

export type NoiseModel = "poisson" | "overdispersed";

export interface Noise {
  model: NoiseModel;
  /** Uniform in [0, 1). */
  next: () => number;
  /** Visits in a month with mean `lambda`. */
  visits: (lambda: number) => number;
  /** A ticket of mean `meanCents`, in whole cents, never under a fifth of the mean. */
  ticket: (meanCents: number) => number;
  /** `cents` moved by up to `share` either way. */
  jitter: (cents: number, share: number) => number;
}

export function noise(seed: number, model: NoiseModel): Noise {
  const next = rng(seed);
  const normal = () => {
    // Box-Muller; 1 - u keeps the logarithm finite
    const u = 1 - next();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * next());
  };
  const poisson = (lambda: number) => {
    if (lambda <= 0) return 0;
    const limit = Math.exp(-lambda);
    let k = 0;
    for (let p = next(); p > limit; p *= next()) k++;
    return k;
  };
  // Marsaglia and Tsang for shape >= 1, mean 1
  const gamma = (shape: number) => {
    const d = shape - 1 / 3;
    const c = 1 / Math.sqrt(9 * d);
    for (;;) {
      let x: number;
      let v: number;
      do {
        x = normal();
        v = 1 + c * x;
      } while (v <= 0);
      v = v * v * v;
      if (Math.log(1 - next()) < 0.5 * x * x + d - d * v + d * Math.log(v)) return (d * v) / shape;
    }
  };
  // a shape of 2 gives a variance of lambda + lambda² / 2: a month twice as busy as usual is common
  const visits = model === "poisson" ? poisson : (lambda: number) => poisson(lambda * gamma(2));
  const sigma = 0.55;
  const ticket = (mean: number) => {
    const x = model === "poisson" ? mean * (1 + 0.25 * normal()) : mean * Math.exp(sigma * normal() - (sigma * sigma) / 2);
    return Math.round(Math.max(mean / 5, x));
  };
  const jitter = (cents: number, share: number) => Math.round(cents * (1 + share * (2 * next() - 1)));
  return { model, next, visits, ticket, jitter };
}
