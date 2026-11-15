/**
 * Rule 23: every job of a workflow names the runner image it runs on. A label such as `ubuntu-latest` moves to the next
 * image on a day GitHub picks, and a release would then be built and smoke tested on an image no run has seen. A newer
 * image is a change of its own: RUNNERS and the workflows change together, and the release workflow is rehearsed with
 * its `dry_run` input before the next release.
 */

/** The second one is the arm64 half of a release. It is free for public repositories, like the first. */
export const RUNNERS = ["ubuntu-24.04", "ubuntu-24.04-arm"];

const MATRIX = /^\$\{\{\s*matrix\.([A-Za-z_][\w-]*)\s*\}\}$/;

/** A scalar as one line of YAML writes it: without the comment after it and the quotes around it. */
const scalar = (raw: string) => raw.replace(/(^|\s)#.*$/, "").trim().replace(/^(["'])(.*)\1$/, "$2");

/**
 * Every value a workflow gives the key `key`: in a block or flow mapping (an `include` entry), as a flow list or as a
 * block list (a dimension of the matrix). The file is read by line, with no YAML parser, so a key of the same name
 * elsewhere in the file counts too. That can only refuse more.
 */
function valuesOf(lines: readonly string[], key: string): string[] {
  const block = new RegExp(`^(\\s*)(?:-\\s+)?${key}:(.*)$`);
  const flow = new RegExp(`[{,]\\s*${key}:\\s*([^,}]*)`, "g");
  const out: string[] = [];
  lines.forEach((line, i) => {
    if (/^\s*#/.test(line)) return;
    const b = block.exec(line);
    if (!b) {
      for (const m of line.matchAll(flow)) out.push(scalar(m[1] ?? ""));
      return;
    }
    const value = scalar(b[2] ?? "");
    if (value.startsWith("[")) out.push(...value.replace(/^\[|\]$/g, "").split(",").map(scalar));
    else if (value !== "") out.push(value);
    else {
      for (const next of lines.slice(i + 1)) {
        if (/^\s*(#.*)?$/.test(next)) continue;
        const item = /^(\s*)-\s+(.*)$/.exec(next);
        if (!item || (item[1] ?? "").length < (b[1] ?? "").length) break;
        out.push(scalar(item[2] ?? ""));
      }
    }
  });
  return out;
}

/**
 * The `runs-on` lines of a workflow that do not name one of RUNNERS. `${{ matrix.KEY }}` passes when the file gives KEY
 * a value and every value is one of RUNNERS. Any other expression is refused, because nothing here can say what it
 * becomes. A line that holds `runs-on:` after something else is refused whatever it names: a job written as one flow
 * mapping, `a: { runs-on: ubuntu-latest, steps: [...] }`, would otherwise never be read.
 */
export function floatingRunners(text: string): { line: number; why: string }[] {
  const lines = text.split("\n");
  const found: { line: number; why: string }[] = [];
  lines.forEach((raw, i) => {
    if (/^\s*#/.test(raw)) return;
    const m = /^\s*(?:-\s+)?["']?runs-on["']?\s*:(.*)$/.exec(raw);
    if (!m) {
      if (/runs-on["']?\s*:/.test(raw)) found.push({ line: i + 1, why: "holds runs-on after something else on the line, where this rule cannot read it" });
      return;
    }
    const value = scalar(m[1] ?? "");
    if (RUNNERS.includes(value)) return;
    const key = MATRIX.exec(value)?.[1];
    let why: string;
    if (key) {
      const values = valuesOf(lines, key);
      const off = [...new Set(values.filter((v) => !RUNNERS.includes(v)))];
      if (values.length > 0 && off.length === 0) return;
      why = values.length === 0 ? `runs on matrix.${key}, and the file gives ${key} no value` : `runs on matrix.${key}, which can be ${off.join(", ")}`;
    } else if (value === "") why = "names its runner on other lines";
    else if (/-latest$/.test(value)) why = `${value} moves to a newer image on a day GitHub picks`;
    else why = `${value} is not ${RUNNERS.join(" or ")}`;
    found.push({ line: i + 1, why });
  });
  return found;
}
