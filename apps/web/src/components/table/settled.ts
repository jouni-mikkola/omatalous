/**
 * The promise with the fields React's `use()` reads (`status`, `value`), set when it settles. `use()` hands back the value of
 * a settled promise at once only when it has seen it settle itself; one it meets after the fact suspends the render once.
 * A hook that calls `use()` on every render, as React asks (a render that suspended must call it again when it resumes),
 * needs this, so a table whose chunks are there draws at once, in the browser and in a test that awaited them.
 */
export function settled<T>(promise: Promise<T>): Promise<T> {
  const tracked = promise as Promise<T> & { status?: "fulfilled"; value?: T };
  // only the settled state is written: React tracks a pending or rejected promise itself, and a rejection reaches its error boundary
  promise.then(
    (value) => {
      tracked.status = "fulfilled";
      tracked.value = value;
    },
    () => {},
  );
  return promise;
}
