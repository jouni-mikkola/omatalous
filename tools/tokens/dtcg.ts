/**
 * Reads apps/web/design/tokens.json (Design Tokens format 2025.10) and turns it into the values the stylesheet and the
 * typed module need. Pure: text in, text out, so the build and its test share it and nothing here touches the disk.
 *
 * The file has groups of tokens. The CSS name of a token is `--` plus its own key, so a key is unique in the whole
 * file. The format has no modes and the app has one look (a light one), so there is no second value to carry. What the format has no
 * place for goes under `$extensions`:
 *   fi.omatalous.media   { "<media query>": <value in the same shape> } the value the token takes under that query
 *   fi.omatalous.css     { "suffix": "%" | "em" } the unit of a `number` token that is written with one
 */

export type Oklch = { colorSpace: "oklch"; components: [number, number, number]; alpha?: number };
export type Token = {
  /** Group the token sits in (`color`, `size` ...). */
  group: string;
  /** The key, which is also the CSS name without the dashes. */
  key: string;
  type: string;
  value: unknown;
  /** The value under each media query, in file order. */
  media: [string, unknown][];
  suffix: string;
};

const TYPES = ["color", "dimension", "duration", "number", "fontFamily", "fontWeight", "cubicBezier", "shadow"] as const;
const GENERIC = new Set(["system-ui", "ui-monospace", "sans-serif", "serif", "monospace"]);
const ALIAS = /^\{([^{}]+)\}$/;
/** Rounding slack when a colour sits on the edge of the sRGB cube. */
const GAMUT_SLACK = 0.0005;

type Node = Record<string, unknown>;
const isNode = (v: unknown): v is Node => typeof v === "object" && v !== null && !Array.isArray(v);

/** The tokens of a parsed file, in file order. Throws one error that lists every problem found. */
export function readTokens(file: unknown): Token[] {
  const problems: string[] = [];
  const tokens: Token[] = [];
  const seen = new Map<string, string>();
  if (!isNode(file)) throw new Error("tokens.json: the file is not an object");
  const walk = (node: Node, path: string[], inherited: string | undefined): void => {
    const type = typeof node.$type === "string" ? node.$type : inherited;
    for (const [k, v] of Object.entries(node)) {
      if (k.startsWith("$") || !isNode(v)) continue;
      const here = [...path, k];
      if ("$value" in v) {
        const name = here.join(".");
        const own = typeof v.$type === "string" ? v.$type : type;
        if (own === undefined || !(TYPES as readonly string[]).includes(own)) {
          problems.push(`${name}: unknown or missing $type ${JSON.stringify(own)}`);
          continue;
        }
        if (seen.has(k)) problems.push(`${name}: the key "${k}" is also ${seen.get(k)}, and a key is a CSS name, so it must be unique`);
        seen.set(k, name);
        const ext = isNode(v.$extensions) ? v.$extensions : {};
        const media = isNode(ext["fi.omatalous.media"]) ? Object.entries(ext["fi.omatalous.media"]) : [];
        const css = isNode(ext["fi.omatalous.css"]) ? ext["fi.omatalous.css"] : {};
        tokens.push({ group: path[0] ?? "", key: k, type: own, value: v.$value, media, suffix: typeof css.suffix === "string" ? css.suffix : "" });
      } else walk(v, here, type);
    }
  };
  walk(file, [], undefined);
  const byPath = new Map(tokens.map((t) => [`${t.group}.${t.key}`, t]));
  for (const t of tokens) {
    for (const [where, value] of [["", t.value], ...t.media.map(([q, x]) => [` under ${q}`, x] as [string, unknown])] as [string, unknown][]) {
      const alias = typeof value === "string" ? ALIAS.exec(value) : null;
      if (alias) {
        if (!byPath.has(alias[1]!)) problems.push(`${t.group}.${t.key}${where}: the alias ${value} names no token`);
        continue;
      }
      const why = invalid(t.type, value);
      if (why) problems.push(`${t.group}.${t.key}${where}: ${why}`);
    }
  }
  if (problems.length) throw new Error(`tokens.json:\n  ${problems.join("\n  ")}`);
  return tokens;
}

const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** What is wrong with a value of this type, or null. */
function invalid(type: string, v: unknown): string | null {
  switch (type) {
    case "color": {
      if (!isNode(v) || v.colorSpace !== "oklch" || !Array.isArray(v.components) || v.components.length !== 3 || !v.components.every(num)) {
        return "a colour is { colorSpace: \"oklch\", components: [L, C, H] }";
      }
      const [l, c, h] = v.components as [number, number, number];
      if (l < 0 || l > 1 || c < 0) return "lightness is 0 to 1 and chroma is not negative";
      if (v.alpha !== undefined && (!num(v.alpha) || v.alpha < 0 || v.alpha > 1)) return "alpha is 0 to 1";
      const rgb = oklchToLinear(l, c, h);
      if (rgb.some((x) => x < -GAMUT_SLACK || x > 1 + GAMUT_SLACK)) return `oklch(${l} ${c} ${h}) is outside sRGB`;
      return null;
    }
    case "dimension":
      return isNode(v) && num(v.value) && (v.unit === "px" || v.unit === "rem") ? null : "a dimension is { value, unit: \"px\" | \"rem\" }";
    case "duration":
      return isNode(v) && num(v.value) && (v.unit === "ms" || v.unit === "s") ? null : "a duration is { value, unit: \"ms\" | \"s\" }";
    case "number":
      return num(v) ? null : "a number is a number";
    case "fontWeight":
      return num(v) && v >= 1 && v <= 1000 ? null : "a font weight is 1 to 1000";
    case "fontFamily":
      return typeof v === "string" || (Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === "string")) ? null : "a font family is a name or a list of names";
    case "cubicBezier":
      return Array.isArray(v) && v.length === 4 && v.every(num) && (v[0] as number) >= 0 && (v[0] as number) <= 1 && (v[2] as number) >= 0 && (v[2] as number) <= 1
        ? null
        : "a cubic bezier is 4 numbers, x1 and x2 between 0 and 1";
    case "shadow": {
      const layers = Array.isArray(v) ? v : [v];
      for (const l of layers) {
        if (!isNode(l)) return "a shadow is a layer or a list of layers";
        if (invalid("color", l.color)) return "a shadow layer needs a colour";
        for (const k of ["offsetX", "offsetY", "blur", "spread"]) if (invalid("dimension", l[k])) return `a shadow layer needs ${k} as a dimension`;
      }
      return null;
    }
    default:
      return `unknown type ${type}`;
  }
}

/** Linear sRGB of an OKLCH colour (Bjorn Ottosson's matrices). */
export function oklchToLinear(l: number, c: number, h: number): [number, number, number] {
  const a = c * Math.cos((h * Math.PI) / 180);
  const b = c * Math.sin((h * Math.PI) / 180);
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
    -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
    -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_,
  ];
}

/** `#rrggbb` of an opaque OKLCH colour, rounded to 8 bits like a browser paints it. */
export function oklchToHex(color: Oklch): string {
  const [l, c, h] = color.components;
  const channel = (x: number): string => {
    const v = Math.min(1, Math.max(0, x));
    const s = v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;
    return Math.round(s * 255).toString(16).padStart(2, "0");
  };
  return `#${oklchToLinear(l, c, h).map(channel).join("")}`;
}

const n = (x: number): string => String(Math.round(x * 1e6) / 1e6);

/** The CSS text of one value of a token. An alias becomes the variable it names. */
export function cssValue(t: Token, value: unknown): string {
  const alias = typeof value === "string" ? ALIAS.exec(value) : null;
  if (alias) return `var(--${alias[1]!.split(".").pop()})`;
  switch (t.type) {
    case "color": {
      const c = value as Oklch;
      const [l, ch, h] = c.components;
      return `oklch(${n(l)} ${n(ch)} ${n(h)}${c.alpha !== undefined && c.alpha < 1 ? ` / ${n(c.alpha)}` : ""})`;
    }
    case "dimension":
    case "duration": {
      const d = value as { value: number; unit: string };
      return `${n(d.value)}${d.value === 0 && d.unit !== "ms" && d.unit !== "s" ? "" : d.unit}`;
    }
    case "number":
      return `${n(value as number)}${t.suffix}`;
    case "fontWeight":
      return String(value);
    case "fontFamily": {
      const list = typeof value === "string" ? [value] : (value as string[]);
      return list.map((f) => (GENERIC.has(f) || !/\s/.test(f) ? f : JSON.stringify(f))).join(", ");
    }
    case "cubicBezier":
      return `cubic-bezier(${(value as number[]).map(n).join(", ")})`;
    case "shadow": {
      const layers = Array.isArray(value) ? value : [value];
      return layers
        .map((l) => {
          const s = l as Record<string, { value: number; unit: string }> & { color: Oklch; inset?: boolean };
          const px = (d: { value: number; unit: string }) => `${n(d.value)}${d.value === 0 ? "" : d.unit}`;
          return `${s.inset ? "inset " : ""}${px(s.offsetX!)} ${px(s.offsetY!)} ${px(s.blur!)} ${px(s.spread!)} ${cssValue({ ...t, type: "color" }, s.color)}`;
        })
        .join(", ");
    }
    default:
      throw new Error(`no CSS form for ${t.type}`);
  }
}

/** A number in px, ms or plain, for the typed module: rem is 16 px, s is 1000 ms. */
export function plainNumber(value: unknown): number | null {
  if (num(value)) return value;
  if (isNode(value) && num(value.value)) {
    const u = value.unit;
    return u === "rem" ? value.value * 16 : u === "s" ? value.value * 1000 : value.value;
  }
  return null;
}
