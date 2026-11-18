import { describe, expect, it } from "vitest";
import { tidyPictureText } from "../src/components/loans/picture-text.ts";

describe("tidyPictureText", () => {
  it("joins a capital the reader split from its word", () => {
    expect(tidyPictureText("L yhennystapa")).toBe("Lyhennystapa");
    expect(tidyPictureText("T asalyhennys")).toBe("Tasalyhennys");
    for (const letter of ["F", "L", "P", "T", "V", "W", "Y"]) expect(tidyPictureText(`${letter} alkka`)).toBe(`${letter}alkka`);
  });

  it("joins at the start of a line, after a colon and after a digit, on every line", () => {
    expect(tidyPictureText("Lainan tyyppi: T asalyhennys\nV iitekorko 3,10 %\n2 P alkka")).toBe("Lainan tyyppi: Tasalyhennys\nViitekorko 3,10 %\n2 Palkka");
  });

  it("joins two splits in a row", () => {
    expect(tidyPictureText("L yhennystapa P alkka")).toBe("Lyhennystapa Palkka");
  });

  it("leaves a lone capital before a number or a short word alone", () => {
    expect(tidyPictureText("V 2026")).toBe("V 2026");
    expect(tidyPictureText("L on")).toBe("L on");
    expect(tidyPictureText("P ja T")).toBe("P ja T");
    expect(tidyPictureText("Y alk")).toBe("Y alk");
  });

  it("leaves a lone capital before a capital or after a letter alone", () => {
    expect(tidyPictureText("L Yhennystapa")).toBe("L Yhennystapa");
    expect(tidyPictureText("AL yhennystapa")).toBe("AL yhennystapa");
    expect(tidyPictureText("5L yhennystapa")).toBe("5L yhennystapa");
  });

  it("leaves a word that is a word alone, in English and with other capitals", () => {
    expect(tidyPictureText("A loan I have")).toBe("A loan I have");
    expect(tidyPictureText("Q uarter")).toBe("Q uarter");
    expect(tidyPictureText("l yhennystapa")).toBe("l yhennystapa");
  });

  it("does not join across a line break or a wider gap", () => {
    expect(tidyPictureText("L\nyhennystapa")).toBe("L\nyhennystapa");
    expect(tidyPictureText("L  yhennystapa")).toBe("L  yhennystapa");
  });
});
