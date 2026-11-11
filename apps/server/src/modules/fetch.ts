/**
 * Finds and downloads an add-on module bundle from the releases of the code's repository (docs/MODULES.md, "What the
 * host does", 1). HTTPS only; the token goes only to api.github.com, and a redirect (GitHub sends the asset from
 * another host) is followed only to an https address and without it. Nothing here logs: the code is a secret.
 */
import { readCapped } from "../platform/outbound.ts";
import type { ModuleCode } from "./code.ts";
import { compareVersions, parseVersion } from "./semver.ts";
import { LIMITS } from "./tar.ts";

const API = "https://api.github.com";
const ASSET = /^module-(\d+\.\d+\.\d+)\.tar\.gz$/;
const LIST_MAX = 2 * 1024 * 1024;
const SIG_MAX = 8 * 1024;
const TIMEOUT_MS = 30_000;
/** How many of the newest releases are tried before the check gives up. */
const TRIED = 5;

export class FetchFailed extends Error {
  override name = "FetchFailed";
}

export interface Candidate {
  version: string;
  bundleUrl: string;
  sigUrl: string;
}

interface ReleaseAsset {
  name?: unknown;
  url?: unknown;
}
interface Release {
  draft?: unknown;
  prerelease?: unknown;
  assets?: unknown;
}

const apiAddress = (url: string) => url.startsWith(`${API}/`);

async function get(fetchImpl: typeof fetch, url: string, token: string, accept: string): Promise<Response> {
  let address = url;
  for (let hop = 0; hop < 4; hop++) {
    if (!address.startsWith("https://")) throw new FetchFailed("a download address is not https");
    const headers: Record<string, string> = { Accept: accept, "User-Agent": "omatalous", "X-GitHub-Api-Version": "2022-11-28" };
    if (apiAddress(address)) headers.Authorization = `Bearer ${token}`;
    let res: Response;
    try {
      res = await fetchImpl(address, { headers, redirect: "manual", signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch {
      throw new FetchFailed("the release service did not answer");
    }
    if (res.status >= 300 && res.status < 400) {
      const next = res.headers.get("location");
      void res.body?.cancel().catch(() => {});
      if (!next) throw new FetchFailed("the release service sent a redirect with no address");
      address = new URL(next, address).href;
      continue;
    }
    if (res.status === 401 || res.status === 403 || res.status === 404) {
      void res.body?.cancel().catch(() => {});
      throw new FetchFailed("the code does not open the releases");
    }
    if (!res.ok) {
      void res.body?.cancel().catch(() => {});
      throw new FetchFailed("the release service answered with an error");
    }
    return res;
  }
  throw new FetchFailed("too many redirects");
}

/** The newest releases that carry both assets, newest first, at most TRIED. Drafts and prereleases are left out. */
export async function listCandidates(fetchImpl: typeof fetch, code: ModuleCode): Promise<Candidate[]> {
  const res = await get(fetchImpl, `${API}/repos/${code.repo}/releases?per_page=30`, code.token, "application/vnd.github+json");
  const body = await readCapped(res, LIST_MAX);
  if (!body) throw new FetchFailed("the list of releases is too long");
  let releases: unknown;
  try {
    releases = JSON.parse(Buffer.from(body).toString("utf8"));
  } catch {
    throw new FetchFailed("the list of releases is not JSON");
  }
  if (!Array.isArray(releases)) throw new FetchFailed("the list of releases is not a list");
  const out: Candidate[] = [];
  for (const r of releases as Release[]) {
    if (r.draft !== false || r.prerelease !== false || !Array.isArray(r.assets)) continue;
    const assets = r.assets as ReleaseAsset[];
    for (const a of assets) {
      const m = typeof a.name === "string" ? ASSET.exec(a.name) : null;
      if (!m || typeof a.url !== "string" || !apiAddress(a.url)) continue;
      const sig = assets.find((x) => x.name === `${a.name}.sig`);
      if (!sig || typeof sig.url !== "string" || !apiAddress(sig.url)) continue;
      if (!out.some((c) => c.version === m[1])) out.push({ version: m[1]!, bundleUrl: a.url, sigUrl: sig.url });
    }
  }
  return out.sort((a, b) => compareVersions(parseVersion(b.version)!, parseVersion(a.version)!)).slice(0, TRIED);
}

/** The bundle and its signature, each read up to its limit. */
export async function download(fetchImpl: typeof fetch, code: ModuleCode, c: Candidate): Promise<{ packed: Buffer; signature: Buffer }> {
  const packed = await readCapped(await get(fetchImpl, c.bundleUrl, code.token, "application/octet-stream"), LIMITS.packedBytes);
  if (!packed) throw new FetchFailed("the bundle is too large");
  const signature = await readCapped(await get(fetchImpl, c.sigUrl, code.token, "application/octet-stream"), SIG_MAX);
  if (!signature) throw new FetchFailed("the signature is too large");
  return { packed: Buffer.from(packed), signature: Buffer.from(signature) };
}
