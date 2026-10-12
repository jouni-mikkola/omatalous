/**
 * The pixel size of a picture, read from its first bytes. A browser decodes a picture to width x height x 4 bytes, so a
 * file of a few megabytes can be a picture of billions of pixels that fills a phone's memory: the size is checked
 * before anything is decoded.
 */
export interface PictureSize {
  width: number;
  height: number;
}

/** The size sits in the first bytes of every format. A JPEG puts it after its metadata, which is rarely over 200 kB. */
const HEAD_BYTES = 1 << 20;

const ascii = (b: Uint8Array, at: number, text: string) => text.length + at <= b.length && [...text].every((c, i) => b[at + i] === c.charCodeAt(0));

/** The size a picture's header declares, or null when the format is not one of PNG, JPEG, GIF, WebP, BMP, AVIF or HEIC. */
export function sizeOfHeader(b: Uint8Array): PictureSize | null {
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const size = (width: number, height: number): PictureSize | null => (width > 0 && height > 0 ? { width, height } : null);
  const has = (bytes: number, at: number) => at + bytes <= b.length;

  if (ascii(b, 1, "PNG") && b[0] === 0x89 && ascii(b, 12, "IHDR") && has(24, 0)) return size(view.getUint32(16), view.getUint32(20));
  if (ascii(b, 0, "GIF8") && has(10, 0)) return size(view.getUint16(6, true), view.getUint16(8, true));
  if (ascii(b, 0, "BM") && has(26, 0)) {
    // the old core header holds 16-bit sizes, the others signed 32-bit ones (a negative height is a top-down picture)
    return view.getUint32(14, true) === 12 ? size(view.getUint16(18, true), view.getUint16(20, true)) : size(view.getInt32(18, true), Math.abs(view.getInt32(22, true)));
  }
  if (ascii(b, 0, "RIFF") && ascii(b, 8, "WEBP") && has(30, 0)) {
    if (ascii(b, 12, "VP8X")) return size(1 + (b[24]! | (b[25]! << 8) | (b[26]! << 16)), 1 + (b[27]! | (b[28]! << 8) | (b[29]! << 16)));
    if (ascii(b, 12, "VP8L")) {
      const bits = view.getUint32(21, true);
      return size(1 + (bits & 0x3fff), 1 + ((bits >> 14) & 0x3fff));
    }
    if (ascii(b, 12, "VP8 ")) return size(view.getUint16(26, true) & 0x3fff, view.getUint16(28, true) & 0x3fff);
    return null;
  }
  if (b[0] === 0xff && b[1] === 0xd8) {
    // walk the segments to the first start-of-frame marker
    let at = 2;
    while (has(4, at) && b[at] === 0xff) {
      const marker = b[at + 1]!;
      if (marker === 0xff) at++;
      else if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) at += 2;
      else if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return has(9, at) ? size(view.getUint16(at + 7), view.getUint16(at + 5)) : null;
      else if (marker === 0xda) return null;
      else at += 2 + view.getUint16(at + 2);
    }
    return null;
  }
  if (ascii(b, 4, "ftyp")) {
    // AVIF and HEIC: the largest image-extent box (ispe) found counts, whichever image it describes
    let found: PictureSize | null = null;
    for (let at = 8; has(16, at); at++) {
      if (!ascii(b, at, "ispe")) continue;
      const one = size(view.getUint32(at + 8), view.getUint32(at + 12));
      if (one && (!found || one.width * one.height > found.width * found.height)) found = one;
    }
    return found;
  }
  return null;
}

export async function pictureSize(picture: Blob): Promise<PictureSize | null> {
  return sizeOfHeader(new Uint8Array(await picture.slice(0, HEAD_BYTES).arrayBuffer()));
}
