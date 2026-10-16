import { describe, expect, it } from "vitest";
import { asks, classifiedPercent, percentText, serviceQuestion, walletQuestion } from "../src/components/questions.ts";

describe("a share as the page says it", () => {
  it("is a whole percent rounded down, and alle 1 % for a share above 0 that rounds to nothing", () => {
    expect(percentText(0.874)).toBe("87 %");
    expect(percentText(0.999)).toBe("99 %");
    expect(percentText(1)).toBe("100 %");
    expect(percentText(0.004)).toBe("alle 1 %");
    expect(percentText(0.0099)).toBe("alle 1 %");
    expect(percentText(0.01)).toBe("1 %");
    expect(percentText(0)).toBe("0 %");
  });
});

describe("the percent of the money that is classified", () => {
  it("rounds down to a whole percent, never up to 100", () => {
    expect(classifiedPercent(0.996)).toBe(99);
    expect(classifiedPercent(0.99999)).toBe(99);
    expect(classifiedPercent(0.789)).toBe(78);
    expect(classifiedPercent(0)).toBe(0);
    expect(classifiedPercent(1)).toBe(100);
  });

  it("is not moved by the float's last digits", () => {
    // 0.29 * 100 is 28.999999999999996
    expect(classifiedPercent(0.29)).toBe(29);
    expect(classifiedPercent(1 - 22000 / 100000)).toBe(78);
    expect(classifiedPercent(1 - 35000 / 215000)).toBe(83);
  });
});

describe("when the block is drawn", () => {
  const item = { kind: "payee_out" };
  it("needs a share, and then something to ask or under 95 %", () => {
    expect(asks({ share: null, items: [item] })).toBe(false);
    expect(asks({ share: 0.99, items: [item] })).toBe(true);
    expect(asks({ share: 0.94, items: [] })).toBe(true);
    expect(asks({ share: 0.95, items: [] })).toBe(false);
    expect(asks({ share: 1, items: [] })).toBe(false);
  });
});

describe("the questions about MobilePay and the payment services", () => {
  const plain = (s: string) => s.replace(/\s/g, " ");
  it("count one payment as maksu and any other number as maksua", () => {
    expect(plain(walletQuestion(1, 2500))).toBe("Saapuneet MobilePay-maksut, 1 maksu, yhteensä 25,00 €. Mitä ne ovat?");
    expect(plain(walletQuestion(3, 21000))).toBe("Saapuneet MobilePay-maksut, 3 maksua, yhteensä 210,00 €. Mitä ne ovat?");
    expect(plain(serviceQuestion("Trustly", 1, 4000))).toBe("Trustly-maksut, 1 maksu, yhteensä 40,00 €. Mihin ne menivät?");
    expect(plain(serviceQuestion("Svea Payments", 2, 500))).toBe("Svea Payments -maksut, 2 maksua, yhteensä 5,00 €. Mihin ne menivät?");
    expect(plain(serviceQuestion("PayPal", 3, 12000))).toBe("PayPal-maksut, 3 maksua, yhteensä 120,00 €. Mihin ne menivät?");
  });
});
