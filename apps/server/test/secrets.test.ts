import { X509Certificate } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.ts";
import { runCli } from "../src/cli.ts";
import { hourIn, loadConfig } from "../src/platform/config.ts";
import { openDatabase } from "../src/db/open.ts";
import { loadOrCreateAppSecret } from "../src/entry/app-secret.ts";
import { generateKeyAndCertificate } from "../src/security/x509.ts";
import { isSyncHour } from "../src/services/instance.ts";

const tmp = () => mkdtempSync(join(tmpdir(), "talous-secret-"));

describe("app secret file", () => {
  it("is created once with mode 600 and reused afterwards", () => {
    const path = join(tmp(), "secrets", "app_secret");
    const first = loadOrCreateAppSecret(path);
    expect(first).toMatchObject({ created: true });
    expect(first.secret!.length).toBeGreaterThanOrEqual(64);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    const second = loadOrCreateAppSecret(path);
    expect(second).toEqual({ secret: first.secret, created: false });
  });

  it("returns a problem at once for a path Node's recursive mkdir would hang on", () => {
    // mkdirSync(recursive) under /proc never returns, which used to freeze the whole server at start
    const r = loadOrCreateAppSecret("/proc/nope/sub/app_secret");
    expect(r.secret).toBeNull();
  }, 5000);

  it("never replaces an existing file, even a too short one", () => {
    const path = join(tmp(), "app_secret");
    writeFileSync(path, "short\n", { mode: 0o600 });
    expect(loadOrCreateAppSecret(path).secret).toBeNull();
    expect(readFileSync(path, "utf8")).toBe("short\n");
  });

  it("does not follow a planted symlink when creating", () => {
    const dir = tmp();
    const target = join(dir, "elsewhere");
    symlinkSync(target, join(dir, "app_secret"));
    const r = loadOrCreateAppSecret(join(dir, "app_secret"));
    expect(r.secret).toBeNull();
    expect(existsSync(target)).toBe(false);
  });
});

describe("self-signed certificate", () => {
  it("is a valid X.509 v3 certificate for the generated key", async () => {
    const now = new Date("2026-10-09T10:00:00Z");
    const { certificatePem, privateKeyPem } = await generateKeyAndCertificate({ commonName: "talous test", now });
    const cert = new X509Certificate(certificatePem);
    expect(cert.subject).toBe("CN=talous test");
    expect(cert.issuer).toBe(cert.subject);
    expect(new Date(cert.validFrom).toISOString()).toBe(now.toISOString());
    expect(new Date(cert.validTo).getUTCFullYear()).toBe(2036);
    expect(cert.verify(cert.publicKey)).toBe(true);
    expect(cert.checkPrivateKey((await import("node:crypto")).createPrivateKey(privateKeyPem))).toBe(true);
    expect(cert.publicKey.asymmetricKeyDetails?.modulusLength).toBe(2048);
  });

  it("uses GeneralizedTime after 2049", async () => {
    const { certificatePem } = await generateKeyAndCertificate({ commonName: "x", now: new Date("2045-01-01T00:00:00Z"), years: 10 });
    expect(new Date(new X509Certificate(certificatePem).validTo).getUTCFullYear()).toBe(2055);
  });
});

describe("scheduler hours", () => {
  it("compares the local hour of the instance time zone", () => {
    const at = new Date("2026-10-09T03:15:00Z"); // 06:15 in Helsinki (UTC+3 in October)
    expect(hourIn("Europe/Helsinki", at)).toBe(6);
    expect(isSyncHour({ syncHours: [6, 18] }, hourIn("Europe/Helsinki", at))).toBe(true);
    expect(isSyncHour({ syncHours: [6, 18] }, hourIn("UTC", at))).toBe(false);
    expect(hourIn("UTC", new Date("2026-10-09T00:30:00Z"))).toBe(0);
  });
});

describe("setup-code CLI", () => {
  it("prints a fresh code that creates the first admin, then refuses", async () => {
    const { db } = await openDatabase(":memory:");
    const app = createApp({ db, config: loadConfig({ PASSWORD_ITERATIONS: "1000" }) });
    const out: string[] = [];
    const log = console.log;
    console.log = (line: string) => out.push(line);
    try {
      expect(await runCli(app.services, ["setup-code"])).toBe(0);
    } finally {
      console.log = log;
    }
    const code = out[0]!;
    expect(code).toMatch(/^\w{4}-\w{4}-\w{4}-\w{4}$/);
    const res = await app.request("http://localhost:8080/api/auth/setup", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Requested-With": "fetch" },
      body: JSON.stringify({ code, username: "aino", displayName: "Aino", password: "aino-salasana-123" }),
    });
    expect(res.status).toBe(200);
    out.length = 0;
    console.log = (line: string) => out.push(line);
    try {
      await runCli(app.services, ["setup-code"]);
    } finally {
      console.log = log;
    }
    expect(out[0]).toContain("already exists");
  });
});
