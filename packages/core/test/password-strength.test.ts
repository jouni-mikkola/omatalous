import { describe, expect, it } from "vitest";
import { checkPassword } from "../src/index.ts";

describe("checkPassword", () => {
  it("refuses a common password with the reason", () => {
    expect(checkPassword("Salasana123456").problem).toMatch(/liian yleinen/);
    expect(checkPassword("password1234").problem).toMatch(/liian yleinen/);
    expect(checkPassword("Qwertyuiop1!!").problem).not.toBeNull();
  });
  it("refuses a short, repeated, sequential or username-built password", () => {
    expect(checkPassword("lyhyt").problem).toMatch(/vähintään 12/);
    expect(checkPassword("aaaaaaaaaaaaaa").problem).toMatch(/vähän eri merkkejä/);
    expect(checkPassword("abcdefghijklmn").problem).toMatch(/aakkosista/);
    expect(checkPassword("123456789012").problem).toMatch(/aakkosista/);
    expect(checkPassword("1234567890123456").problem).not.toBeNull();
    expect(checkPassword("PasswordPassword").problem).toMatch(/toistettuna/);
    expect(checkPassword("PasswordＰａｓｓｗｏｒｄ").problem).toMatch(/toistettuna/);
    expect(checkPassword("x".repeat(257)).problem).toMatch(/pitkä/);
  });
  it("refuses a repeated block with digits or signs after it", () => {
    expect(checkPassword("passwordpassword1").issue?.code).toBe("pw.repeated");
    expect(checkPassword("kissakissakissa12!").issue?.code).toBe("pw.repeated");
    expect(checkPassword("hevonenkaivopilvikuu7").problem).toBeNull();
    // a short repeated start with a long tail is carried by the tail
    expect(checkPassword("aa1234567891").problem).toBeNull();
    expect(checkPassword("hahahaha93847561023847").problem).toBeNull();
  });
  it("lets a good one through and grades it", () => {
    const fair = checkPassword("kuusikymmentä");
    const strong = checkPassword("Hevonen-Kaivo-Pilvi-7-Kuu!");
    expect(fair.problem).toBeNull();
    expect(strong.problem).toBeNull();
    expect(strong.level).toBeGreaterThan(fair.level);
    expect(checkPassword("kx7m-q2rt-9wfa-ze4p").problem).toBeNull();
  });
});
