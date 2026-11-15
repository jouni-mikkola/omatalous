/** The page's side of "Tuo tiedot" for the import tests: the file of "Vie kaikki tiedot" read, sent in chunks, checked and committed. */
import { expect } from "vitest";
import type { setupApp } from "./helpers.ts";

export type Setup = Awaited<ReturnType<typeof setupApp>>;
export type Who = { call: Setup["admin"]["call"] };
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- an export file is arbitrary JSON, and the tests edit it freely
export type File = Record<string, any>;

export const exportOf = async (who: Who): Promise<File> => {
  const res = await (who as Setup["admin"]).call("POST", "/api/data/export", {});
  expect(res.status).toBe(200);
  return typeof res.body === "string" ? JSON.parse(res.body) : res.body;
};
export const HEAD_KEYS = ["format", "version", "exportedAt", "appVersion", "exportedBy", "notExported"];

/** The page's part: the head, then the rows of each store in chunks under the size of one, then nothing else. */
export async function upload(who: Who, file: File, over: { head?: object; chunk?: (rows: unknown[], key: string) => object } = {}) {
  const started = await who.call("POST", "/api/data/import", over.head ?? { format: file.format, version: file.version, appVersion: file.appVersion, exportedAt: file.exportedAt });
  if (started.status !== 200) return { started, refused: started };
  const id = started.body.session as string;
  let seq = 0;
  for (const [key, rows] of Object.entries(file)) {
    if (HEAD_KEYS.includes(key) || !Array.isArray(rows)) continue;
    for (let at = 0; at < rows.length || (at === 0 && !rows.length); ) {
      let end = at;
      let size = 0;
      while (end < rows.length && (end === at || size + JSON.stringify(rows[end]).length < 120_000)) size += JSON.stringify(rows[end++]).length;
      const res = await who.call("POST", `/api/data/import/${id}/chunk`, { seq: seq++, stores: { [key]: rows.slice(at, end) } });
      if (res.status !== 200) return { started, id, refused: res };
      at = Math.max(end, at + 1);
    }
  }
  return { started, id, refused: null };
}
export const check = (who: Who, id: string) => who.call("POST", `/api/data/import/${id}/check`, {});
export const commit = (who: Who, id: string) => who.call("POST", `/api/data/import/${id}/commit`, {});
export async function importFile(who: Who, file: File) {
  const up = await upload(who, file);
  expect(up.refused, JSON.stringify(up.refused?.body)).toBeNull();
  const dry = await check(who, up.id!);
  expect(dry.status, JSON.stringify(dry.body)).toBe(200);
  const done = await commit(who, up.id!);
  expect(done.status, JSON.stringify(done.body)).toBe(200);
  return { dry: dry.body, done: done.body };
}
