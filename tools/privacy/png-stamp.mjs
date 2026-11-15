// @ts-check
/**
 * The stamp of a picture `pnpm shots` took: a PNG text chunk `omatalous-shot` naming the made-up household it shows.
 * The privacy check (scan.mjs) lets a picture into the repository only with it, so a screenshot of a real household's
 * app, taken by hand or by a browser session, is refused. Shots takes pictures only of an app it started itself on an
 * empty data folder (e2e/server.mjs), and only at that app's own address.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { crc32 } from "node:zlib";
import { STAMP_KEY, pngTexts } from "./scan.mjs";

/**
 * The PNG with the stamp in a tEXt chunk right after IHDR. A PNG that has one already is returned as it is.
 * @param {Buffer} png
 * @param {string} household what the app held: demo, fake-bank, demo+fake-bank or empty
 */
export function stampPng(png, household) {
  if (png.length < 33 || png.readUInt32BE(0) !== 0x89504e47 || png.toString("latin1", 12, 16) !== "IHDR") throw new Error("not a PNG");
  if (pngTexts(png)[STAMP_KEY]) return png;
  const data = Buffer.from(`${STAMP_KEY}\0${household}`, "latin1");
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  chunk.write("tEXt", 4, "latin1");
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(chunk.subarray(4, 8 + data.length)), 8 + data.length);
  // signature (8) and IHDR (4 + 4 + 13 + 4)
  const at = 33;
  return Buffer.concat([png.subarray(0, at), chunk, png.subarray(at)]);
}

/** @param {string} file @param {string} household */
export function stampFile(file, household) {
  writeFileSync(file, stampPng(readFileSync(file), household));
}
