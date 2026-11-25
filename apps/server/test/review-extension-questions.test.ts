/**
 * An add-on module's questions (`reviewQuestions` in extensions.ts) join the queue of GET /api/review after being
 * confined: an answer goes only to the module's own /api/<id>/ routes, a link only to a page of the app. Made up here.
 */
import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EXTENSIONS, type ExtensionQuestion, type ServerExtension } from "../src/extensions.ts";
import { setupApp } from "./helpers.ts";

afterEach(() => {
  EXTENSIONS.splice(0);
  vi.restoreAllMocks();
});

const questionModule = (id: string, reviewQuestions: ServerExtension["reviewQuestions"]): ServerExtension => ({ id, routes: () => new Hono(), reviewQuestions });
type Choice = ExtensionQuestion["choices"][number];
const question = (choices: unknown[], extra: Partial<ExtensionQuestion> = {}): ExtensionQuestion => ({ id: "renew", type: "example_renew", title: "Esimerkkikauppa", question: "Kirjaudu uudelleen?", choices: choices as Choice[], ...extra });
const answer = (path: string, method: string = "POST", body: unknown = {}) => ({ id: "go", label: "Kyllä", answer: { method, path, body } });
const link = (href: string) => ({ id: "open", label: "Avaa", href });

type Item = { id: string; kind: string; cents: number; choices?: { id: string }[]; [field: string]: unknown };
type Caller = { call(m: string, p: string): Promise<{ body: any }> };
const extensionItems = async (c: Caller) => ((await c.call("GET", "/api/review")).body.items as Item[]).filter((i) => i.kind === "extension");

describe("an add-on module's questions in Tarkistettavat", () => {
  it("are in the queue of the user they are made for, with the module's id in front and the money at stake", async () => {
    const { admin, member, adminId } = await setupApp();
    const bob = await member("bob");
    EXTENSIONS.push(
      questionModule("example", async (_s, user) =>
        user.id === adminId ? [question([answer("/api/example/renew", "PUT", { again: true }), link("#/review?item=x")], { cents: 1200, guess: "go", detail: "Tiedot", date: "2026-10-01" })] : [],
      ),
    );
    const [item, ...more] = await extensionItems(admin);
    expect(more).toEqual([]);
    expect(item).toEqual({
      kind: "extension",
      id: "example:renew",
      type: "example_renew",
      title: "Esimerkkikauppa",
      question: "Kirjaudu uudelleen?",
      detail: "Tiedot",
      date: "2026-10-01",
      guess: "go",
      cents: 1200,
      choices: [answer("/api/example/renew", "PUT", { again: true }), link("#/review?item=x")],
    });
    expect((await admin.call("GET", "/api/review/count")).body.count).toBe(1);
    expect(await extensionItems(bob)).toEqual([]);
  });

  it("send no negative money and go when the module stops returning them", async () => {
    const { admin } = await setupApp();
    let open = true;
    EXTENSIONS.push(questionModule("example", async () => (open ? [question([link("#/review")], { cents: -5 })] : [])));
    expect((await extensionItems(admin))[0]).toMatchObject({ cents: 0 });
    EXTENSIONS.splice(0);
    EXTENSIONS.push(questionModule("example", async () => [question([link("#/review")], { cents: Number.NaN })]));
    expect((await extensionItems(admin))[0]).toMatchObject({ cents: 0 });
    EXTENSIONS.splice(0);
    EXTENSIONS.push(questionModule("example", async () => (open ? [question([link("#/review")], { cents: -5 })] : [])));
    open = false;
    expect(await extensionItems(admin)).toEqual([]);
  });

  it("keep an answer only for a route under the module's own /api/<id>/, with PUT or POST", async () => {
    const { admin } = await setupApp();
    const refused = [
      answer("/api/other/renew"),
      answer("/api/example"),
      answer("/api/examples/renew"),
      answer("/api/security/notices"),
      answer("/api/example/../auth/logout"),
      answer("/api/example/./renew"),
      answer("/api/example//renew"),
      answer("/api/example/%2e%2e/auth"),
      answer("/api/example/renew?x=1"),
      answer("/api/example/renew#x"),
      answer("/api/example/\\renew"),
      answer("/api/example/re new"),
      answer("//example.com/api/example/renew"),
      answer("https://example.com/api/example/renew"),
      answer("api/example/renew"),
      answer("/api/example/renew", "DELETE"),
      answer("/api/example/renew", "GET"),
      answer("/api/example/renew", "POST", { big: "x".repeat(5000) }),
      { id: "go", label: "Kyllä", answer: { method: "POST", path: 7, body: {} } },
      { id: "go", label: "Kyllä" },
    ];
    const allowed = answer("/api/example/renew/7_a.b:c-d");
    EXTENSIONS.push(questionModule("example", async () => [question([...refused, allowed])]));
    const [item] = await extensionItems(admin);
    expect(item!.choices).toEqual([allowed]);
  });

  it("keep a link only to a page of the app, never an address outside it", async () => {
    const { admin } = await setupApp();
    const refused = ["https://example.com", "http://example.com/#/review", "//example.com", "#//example.com", "#/", "#/..", "#/review/../x", "#/review?item=a b", "#/Review", "javascript:alert(1)", "/review", "#review", "#/review\\x", "#/a:b@c"];
    const allowed = [link("#/review"), link("#/review?item=loan-terms:7"), link("#/settings/members"), link("#/example")];
    EXTENSIONS.push(questionModule("example", async () => [question([...refused.map(link), ...allowed])]));
    const [item] = await extensionItems(admin);
    expect(item!.choices).toEqual(allowed);
  });

  it("drop a question left with no choice and a question whose id is not a plain id", async () => {
    const { admin } = await setupApp();
    EXTENSIONS.push(
      questionModule("example", async () => [
        question([answer("/api/other/x")], { id: "no-choice" }),
        question([link("#/review")], { id: "bad id/../" }),
        question([link("#/review")], { id: "" }),
        question([link("#/review")], { id: "fine" }),
      ]),
    );
    expect((await extensionItems(admin)).map((i) => i.id)).toEqual(["example:fine"]);
  });

  it("are left out when the module fails, and another module's stay", async () => {
    const { admin } = await setupApp();
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    EXTENSIONS.push(
      questionModule("broken", async () => {
        throw new Error("boom");
      }),
      questionModule("example", async () => [question([link("#/review")])]),
    );
    const res = await admin.call("GET", "/api/review");
    expect(res.body.items.map((i: Item) => i.id)).toContain("example:renew");
    expect(res.body.items.some((i: Item) => i.id.startsWith("broken:"))).toBe(false);
    expect(error).toHaveBeenCalledWith("review questions of broken failed:", "Error");
  });
});
