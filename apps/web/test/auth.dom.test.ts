import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { checkPassword } from "@banking/core";
import { createElement as h } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChangePassword, Login, PasswordForm, Setup } from "../src/pages/Auth.tsx";
import { failing, stubApi } from "./dom-kit.ts";
import { finnishIn } from "../../../e2e/finnish-words.ts";
import { language, rememberLanguage, setLanguage } from "../src/format.ts";

const user = { id: 1, username: "maija", displayName: "Maija", role: "admin" };
const type = (label: string | RegExp, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const submit = (name: string | RegExp) => fireEvent.click(screen.getByRole("button", { name }));

describe("Login", () => {
  it("posts the username and password and hands the user on", async () => {
    const seen = stubApi({ "POST /api/auth/login": { user } });
    const onDone = vi.fn();
    render(h(Login, { onDone }));
    type("Käyttäjätunnus", "maija");
    type("Salasana", "salasana-123456");
    submit("Kirjaudu sisään");
    await waitFor(() => expect(onDone).toHaveBeenCalledWith(user));
    expect(seen[0]).toMatchObject({ method: "POST", path: "/api/auth/login", body: { username: "maija", password: "salasana-123456" } });
  });

  it("says why a sign-in failed and stays on the form", async () => {
    stubApi({ "POST /api/auth/login": failing(401, { error: "Väärä tunnus tai salasana." }) });
    const onDone = vi.fn();
    render(h(Login, { onDone }));
    type("Käyttäjätunnus", "maija");
    type("Salasana", "väärä");
    submit("Kirjaudu sisään");
    expect((await screen.findByText("Väärä tunnus tai salasana.")).textContent).toBe("Väärä tunnus tai salasana.");
    expect(onDone).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Salasana").getAttribute("aria-invalid")).toBe("true");
  });

  it("asks for the code of the second factor, and for a recovery code on request", async () => {
    const seen = stubApi({ "POST /api/auth/login": { needsFactor: true }, "POST /api/auth/factor": { user } });
    const onDone = vi.fn();
    render(h(Login, { onDone }));
    type("Käyttäjätunnus", "maija");
    type("Salasana", "salasana-123456");
    submit("Kirjaudu sisään");
    await screen.findByLabelText("Koodi sovelluksesta");
    submit("Käytä palautuskoodia");
    type("Palautuskoodi", "abcd-efgh");
    submit("Kirjaudu sisään");
    await waitFor(() => expect(onDone).toHaveBeenCalledWith(user));
    expect(seen.at(-1)).toMatchObject({ path: "/api/auth/factor", body: { code: "abcd-efgh" } });
  });

  it("goes back to the password when the half sign-in has expired, and shows the reason", async () => {
    stubApi({ "POST /api/auth/login": { needsFactor: true }, "POST /api/auth/factor": failing(401, { error: "Aika loppui. Kirjaudu uudelleen.", code: "half_expired" }) });
    render(h(Login, { onDone: vi.fn() }));
    type("Käyttäjätunnus", "maija");
    type("Salasana", "salasana-123456");
    submit("Kirjaudu sisään");
    await screen.findByLabelText("Koodi sovelluksesta");
    type("Koodi sovelluksesta", "123456");
    submit("Kirjaudu sisään");
    await screen.findByText("Aika loppui. Kirjaudu uudelleen.");
    expect((screen.getByLabelText("Salasana") as HTMLInputElement).value).toBe("");
  });

  it("Peruuta in the code step logs the half sign-in out and returns to the password", async () => {
    const seen = stubApi({ "POST /api/auth/login": { needsFactor: true }, "POST /api/auth/logout": { ok: true } });
    render(h(Login, { onDone: vi.fn() }));
    type("Käyttäjätunnus", "maija");
    type("Salasana", "salasana-123456");
    submit("Kirjaudu sisään");
    await screen.findByLabelText("Koodi sovelluksesta");
    submit("Peruuta");
    await screen.findByLabelText("Käyttäjätunnus");
    expect(seen.map((s) => s.path)).toContain("/api/auth/logout");
  });
});

describe("Setup", () => {
  const fill = (over: Record<string, string> = {}) => {
    const v = { Asennuskoodi: "abcd-1234-efgh-5678", Käyttäjätunnus: "maija", Nimi: "Maija", "Salasana (vähintään 12 merkkiä)": "kuusi-hevosta-sataa", "Salasana uudelleen": "kuusi-hevosta-sataa", ...over };
    for (const [label, value] of Object.entries(v)) type(label, value);
  };

  it("names every missing field next to it and sends nothing", () => {
    const seen = stubApi({});
    render(h(Setup, { onDone: vi.fn() }));
    submit("Luo ja kirjaudu");
    expect(screen.getByText("Anna asennuskoodi.")).toBeTruthy();
    expect(screen.getByText(/Käyttäjätunnuksessa pitää olla 3–32 merkkiä/)).toBeTruthy();
    expect(screen.getByText("Anna nimi.")).toBeTruthy();
    expect(seen).toEqual([]);
  });

  it("refuses passwords that differ", () => {
    stubApi({});
    render(h(Setup, { onDone: vi.fn() }));
    fill({ "Salasana uudelleen": "kuusi-hevosta-sata" });
    submit("Luo ja kirjaudu");
    expect(screen.getByText("Salasanat eivät täsmää.")).toBeTruthy();
  });

  it("creates the admin with the typed values", async () => {
    const seen = stubApi({ "POST /api/auth/setup": { user } });
    const onDone = vi.fn();
    render(h(Setup, { onDone }));
    fill();
    submit("Luo ja kirjaudu");
    await waitFor(() => expect(onDone).toHaveBeenCalledWith(user));
    expect(seen[0]!.body).toMatchObject({ code: "abcd-1234-efgh-5678", username: "maija", displayName: "Maija" });
  });

  it("takes the code from the link's fragment and puts a server refusal next to its field", async () => {
    window.location.hash = "#koodi=abcd-1234-efgh-5678";
    stubApi({ "POST /api/auth/setup": failing(400, { error: "Väärä asennuskoodi.", messageCode: "auth.setup_code_wrong" }) });
    render(h(Setup, { onDone: vi.fn() }));
    expect((screen.getByLabelText("Asennuskoodi") as HTMLInputElement).value).toBe("abcd-1234-efgh-5678");
    fill({ Asennuskoodi: "zzzz-1234-efgh-5678" });
    submit("Luo ja kirjaudu");
    const hit = await screen.findByText(/^Väärä asennuskoodi\./);
    expect(hit.className).toBe("field-error");
  });

  it("shows an error that fits no field above the button", async () => {
    stubApi({ "POST /api/auth/setup": failing(500, { error: "Jokin meni pieleen." }) });
    render(h(Setup, { onDone: vi.fn() }));
    fill();
    submit("Luo ja kirjaudu");
    expect(await screen.findByText("Jokin meni pieleen.")).toBeTruthy();
  });
});

describe("password change", () => {
  const fill = (next: string, confirm: string) => {
    type(/^Uusi salasana \(/, next);
    type("Uusi salasana uudelleen", confirm);
    submit("Vaihda salasana");
  };

  it("refuses a weak or unconfirmed password before asking the server", async () => {
    const seen = stubApi({});
    render(h(ChangePassword, { onDone: vi.fn() }));
    fill("aaaaaaaaaaaa", "aaaaaaaaaaaa");
    await screen.findByText(checkPassword("aaaaaaaaaaaa").problem!);
    fill("kuusi-hevosta-sataa", "kuusi-hevosta-sata");
    await screen.findByText("Salasanat eivät täsmää.");
    expect(seen).toEqual([]);
  });

  it("asks only the new password twice and sends it alone", async () => {
    const seen = stubApi({ "POST /api/auth/first-password": { ok: true } });
    const onDone = vi.fn();
    render(h(ChangePassword, { onDone }));
    expect(screen.queryByLabelText("Väliaikainen salasana")).toBeNull();
    expect(screen.queryByLabelText("Nykyinen salasana")).toBeNull();
    fill("kuusi-hevosta-sataa", "kuusi-hevosta-sataa");
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(seen[0]!.body).toEqual({ next: "kuusi-hevosta-sataa" });
  });

  it("sends the current and the new password, and calls onCancel when offered", async () => {
    const seen = stubApi({ "POST /api/auth/password": { ok: true } });
    const onDone = vi.fn();
    const onCancel = vi.fn();
    render(h(PasswordForm, { onDone, onCancel }));
    type("Nykyinen salasana", "vanha-salasana-1");
    type(/^Uusi salasana \(/, "kuusi-hevosta-sataa");
    type("Uusi salasana uudelleen", "kuusi-hevosta-sataa");
    submit("Vaihda salasana");
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(seen[0]!.body).toEqual({ current: "vanha-salasana-1", next: "kuusi-hevosta-sataa" });
    submit("Peruuta");
    expect(onCancel).toHaveBeenCalled();
  });

  it("offers a passkey only when the server says so, and sends the device's answer", async () => {
    const bytes = (...n: number[]) => new Uint8Array(n).buffer;
    const get = vi.fn(async () => ({
      id: "AQID",
      rawId: bytes(1, 2, 3),
      type: "public-key",
      response: { clientDataJSON: bytes(4), authenticatorData: bytes(5), signature: bytes(6), userHandle: null },
      getClientExtensionResults: () => ({}),
      authenticatorAttachment: "platform",
    }));
    vi.stubGlobal("PublicKeyCredential", class {});
    Object.defineProperty(navigator, "credentials", { value: { get }, configurable: true });
    const seen = stubApi({
      "POST /api/auth/login": { needsFactor: true, passkey: true, codes: true },
      "POST /api/auth/passkey/options": { challenge: "AAEC", allowCredentials: [{ id: "AQID", type: "public-key" }] },
      "POST /api/auth/passkey": { user },
    });
    const onDone = vi.fn();
    render(h(Login, { onDone }));
    type("Käyttäjätunnus", "maija");
    type("Salasana", "salasana-123456");
    submit("Kirjaudu sisään");
    await screen.findByRole("button", { name: "Käytä passkeyta" });
    submit("Käytä passkeyta");
    await waitFor(() => expect(onDone).toHaveBeenCalledWith(user));
    expect(get).toHaveBeenCalledOnce();
    expect(seen.at(-1)).toMatchObject({ path: "/api/auth/passkey", body: { response: { id: "AQID", rawId: "AQID", response: { signature: "Bg" } } } });
    vi.unstubAllGlobals();
  });

  it("shows no passkey button when the member has none", async () => {
    stubApi({ "POST /api/auth/login": { needsFactor: true, passkey: false, codes: true } });
    render(h(Login, { onDone: vi.fn() }));
    type("Käyttäjätunnus", "maija");
    type("Salasana", "salasana-123456");
    submit("Kirjaudu sisään");
    await screen.findByLabelText("Koodi sovelluksesta");
    expect(screen.queryByRole("button", { name: "Käytä passkeyta" })).toBeNull();
  });
});

describe("the language of the screens before a sign-in", () => {
  const FINNISH = ["Käyttäjätunnus", "Salasana", "Kirjaudu", "Asennuskoodi", "Luo", "Peruuta"];
  afterEach(() => {
    localStorage.clear();
    setLanguage(null);
  });

  it("is the one kept on the device, and the screens show no Finnish in English", async () => {
    stubApi({ "POST /api/auth/login": { needsFactor: true, passkey: true, codes: true } });
    rememberLanguage("en");
    setLanguage(null);
    for (const screen_ of [h(Login, { onDone: vi.fn() }), h(Setup, { onDone: vi.fn() }), h(ChangePassword, { onDone: vi.fn() })]) {
      const { container, unmount } = render(screen_);
      const found = finnishIn(container.textContent ?? "");
      expect(found, "Finnish words on a screen in English").toEqual([]);
      for (const word of FINNISH) expect(container.textContent).not.toContain(word);
      unmount();
    }
    expect(document.documentElement.lang).toBe("en");
  });

  it("the member's own language is kept on the device when they sign in, and stays after the sign-out", () => {
    setLanguage("en");
    expect(localStorage.getItem("omatalous.language")).toBe("en");
    setLanguage(null);
    expect(language()).toBe("en");
  });

  it("the picker keeps the choice on the device", () => {
    const reload = vi.fn();
    vi.stubGlobal("location", { ...window.location, reload });
    render(h(Login, { onDone: vi.fn() }));
    fireEvent.change(screen.getByLabelText("Kieli / Language"), { target: { value: "en" } });
    expect(localStorage.getItem("omatalous.language")).toBe("en");
    expect(reload).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
  });
});
