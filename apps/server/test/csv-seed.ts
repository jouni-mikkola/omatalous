/**
 * Rows of the old kind (source `csv`) for a test: the app has no import route any more, but accounts imported
 * before it went still hold such rows. The file goes to the import service in this process (csv-import-service.ts),
 * for the user the caller is signed in as, and the answer has the shape the route had: `{ status, body }`, the body
 * as JSON would carry it (a field the result leaves out is absent). The status is 200: a file the fixture cannot
 * read throws.
 *
 * Test code only: nothing under src/ imports it.
 */
import type { Services } from "../src/services/context.ts";
import { type CsvImportInput, importCsv } from "./csv-import-service.ts";

/** What a test client (`setupApp()`'s `admin`, a `member()`) offers: its calls, and for a member its user id. */
export interface SeedCaller {
  call(method: string, path: string, payload?: unknown): Promise<{ status: number; body: any }>;
  id?: string;
}

/** The services of the app under test (`setupApp()`'s `s`) and the signed-in client the rows are for. */
export async function seedCsv(s: Services, caller: SeedCaller, input: CsvImportInput): Promise<{ status: number; body: any }> {
  // a household member from `member()` carries its id; the admin's client is asked who it is signed in as
  const userId = caller.id ?? (await caller.call("GET", "/api/auth/state")).body.user?.id;
  if (!userId) throw new Error("seedCsv: the caller is not signed in");
  return { status: 200, body: JSON.parse(JSON.stringify(await importCsv(s, userId, input))) };
}
