/**
 * PDFs for the browser tests of the loan intake, made here from bytes: no binary file in the repository and no
 * library. Three kinds, each one a real file that any reader opens the same way:
 *  - `textPdf`: lines of text on a page, what a bank's online statement is;
 *  - `scannedPdf`: a page that is one picture and has no text at all, what a scan is;
 *  - `lockedPdf`: the same lines under a password (the standard security handler, 40-bit RC4, the simplest the
 *    format has). A reader needs the password for even the first page.
 * Every line, name and number a test puts in them is made up.
 */
import { createHash } from "node:crypto";

const md5 = (...parts: Buffer[]): Buffer => createHash("md5").update(Buffer.concat(parts)).digest();

/** Text as the bytes of a Windows-1252 font: Finnish letters are one byte each, and the euro sign is 0x80. */
function winAnsi(text: string): Buffer {
  return Buffer.from([...text].map((ch) => (ch === "€" ? 0x80 : ch.charCodeAt(0) & 0xff)));
}

/** A text in a PDF string, with the three characters that mean something inside one written out. */
function literal(text: string): Buffer {
  const bytes: number[] = [0x28];
  for (const byte of winAnsi(text)) {
    if (byte === 0x28 || byte === 0x29 || byte === 0x5c) bytes.push(0x5c);
    bytes.push(byte);
  }
  bytes.push(0x29);
  return Buffer.from(bytes);
}

const stream = (dict: string, data: Buffer): Buffer => Buffer.concat([Buffer.from(`<< ${dict} /Length ${data.length} >>\nstream\n`), data, Buffer.from("\nendstream")]);

/** The file: numbered objects, the table of where each one starts, and the trailer. */
function assemble(objects: Buffer[], trailer: string): Buffer {
  const parts: Buffer[] = [Buffer.from("%PDF-1.4\n")];
  const offsets: number[] = [];
  let at = parts[0]!.length;
  objects.forEach((body, i) => {
    const object = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`), body, Buffer.from("\nendobj\n")]);
    offsets.push(at);
    parts.push(object);
    at += object.length;
  });
  const rows = offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  parts.push(Buffer.from(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${rows}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R ${trailer} >>\nstartxref\n${at}\n%%EOF\n`));
  return Buffer.concat(parts);
}

/** The five objects of a one-page file; `resources` and `content` are the page's own. */
function onePage(resources: string, content: Buffer, extra: Buffer[] = []): Buffer[] {
  return [
    Buffer.from("<< /Type /Catalog /Pages 2 0 R >>"),
    Buffer.from("<< /Type /Pages /Kids [3 0 R] /Count 1 >>"),
    Buffer.from(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << ${resources} >> /Contents 4 0 R >>`),
    stream("", content),
    ...extra,
  ];
}

const FONT = Buffer.from("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");

/** A line with a tab is a table row: its pieces stand in columns, as a statement sets a label and its figure. */
function pageText(lines: readonly string[]): Buffer {
  const out: Buffer[] = [];
  lines.forEach((line, row) => {
    line.split("\t").forEach((piece, column) => {
      if (piece === "") return;
      out.push(Buffer.from(`BT /F1 12 Tf 1 0 0 1 ${60 + column * 270} ${780 - row * 20} Tm `), literal(piece), Buffer.from(" Tj ET\n"));
    });
  });
  return Buffer.concat(out);
}

/** A page of text, one line per row. A tab in a line starts a second column. */
export function textPdf(lines: readonly string[]): Buffer {
  return assemble(onePage("/Font << /F1 5 0 R >>", pageText(lines), [FONT]), "");
}

/**
 * A page that holds one grey picture and no text: the stripes stand where lines of print would be. A reader finds no
 * letters in it, as in a scan that nobody has run through character recognition.
 */
export function scannedPdf(): Buffer {
  const width = 64;
  const height = 48;
  const pixels = Buffer.alloc(width * height, 255);
  for (let y = 4; y < height - 4; y++) {
    if (y % 6 > 2) continue;
    for (let x = 4; x < width - 4 - ((y * 7) % 24); x++) pixels[y * width + x] = 40;
  }
  const picture = stream(`/Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceGray /BitsPerComponent 8`, pixels);
  return assemble(onePage("/XObject << /Im1 5 0 R >>", Buffer.from("q 475 0 0 356 60 400 cm /Im1 Do Q\n"), [picture]), "");
}

/** RC4, the cipher of the format's oldest security handler. */
function rc4(key: Buffer, data: Buffer): Buffer {
  const s = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 0, j = 0; i < 256; i++) {
    j = (j + s[i]! + key[i % key.length]!) & 255;
    [s[i], s[j]] = [s[j]!, s[i]!];
  }
  const out = Buffer.alloc(data.length);
  for (let n = 0, a = 0, b = 0; n < data.length; n++) {
    a = (a + 1) & 255;
    b = (b + s[a]!) & 255;
    [s[a], s[b]] = [s[b]!, s[a]!];
    out[n] = data[n]! ^ s[(s[a]! + s[b]!) & 255]!;
  }
  return out;
}

/** The 32 bytes the format pads a password with. */
const PADDING = Buffer.from([0x28, 0xbf, 0x4e, 0x5e, 0x4e, 0x75, 0x8a, 0x41, 0x64, 0x00, 0x4e, 0x56, 0xff, 0xfa, 0x01, 0x08, 0x2e, 0x2e, 0x00, 0xb6, 0xd0, 0x68, 0x3e, 0x80, 0x2f, 0x0c, 0xa9, 0xfe, 0x64, 0x53, 0x69, 0x7a]);
const padded = (password: string): Buffer => Buffer.concat([Buffer.from(password, "latin1"), PADDING]).subarray(0, 32);

/**
 * `textPdf(lines)` locked with `password`: the text on the page is encrypted, and the file asks for the password
 * before it shows anything. The owner password is another made-up word, so the empty password opens nothing.
 */
export function lockedPdf(lines: readonly string[], password: string): Buffer {
  const permissions = Buffer.alloc(4);
  permissions.writeInt32LE(-4);
  const id = md5(Buffer.from("esimerkki-tiedosto"));
  // the owner entry: the user password, enciphered with a key made of the owner password (R 2)
  const owner = rc4(md5(padded("esimerkki-omistaja")).subarray(0, 5), padded(password));
  // the key of the file, from the user password, the owner entry, the permissions and the id
  const key = md5(padded(password), owner, permissions, id).subarray(0, 5);
  // the user entry: what a reader checks the password it was given against
  const user = rc4(key, PADDING);
  // each object has a key of its own: the file key and the object's number
  const objectKey = (number: number) => md5(key, Buffer.from([number & 255, (number >> 8) & 255, 0, 0, 0])).subarray(0, 10);
  const objects = onePage("/Font << /F1 5 0 R >>", rc4(objectKey(4), pageText(lines)), [FONT]);
  objects.push(Buffer.from(`<< /Filter /Standard /V 1 /R 2 /O <${owner.toString("hex")}> /U <${user.toString("hex")}> /P -4 >>`));
  return assemble(objects, `/Encrypt 6 0 R /ID [<${id.toString("hex")}> <${id.toString("hex")}>]`);
}
