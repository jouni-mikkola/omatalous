import { describe, expect, it } from "vitest";
import { addOnLine } from "../src/pages/settings/addon-line.ts";
import { extensionPages, type WebExtension } from "../src/extensions.ts";

describe("the status line of Asetukset > Palvelin > Lisäosa", () => {
  it("says where the add-on stands in Finnish, and never the server's English reason", () => {
    expect(addOnLine({ state: "none" })).toBe("Ei yhdistetty.");
    expect(addOnLine({ state: "connected", id: "example", version: "1.2.0", label: "Esimerkki" })).toBe("Yhdistetty: Esimerkki, versio 1.2.0.");
    expect(addOnLine({ state: "connected", id: "example", version: "1.2.0" })).toBe("Yhdistetty, versio 1.2.0.");
    expect(addOnLine({ state: "pending", id: "example", version: "1.3.0" })).toMatch(/^Lataus onnistui: versio 1\.3\.0\./);
    expect(addOnLine({ state: "waiting" })).toBe("Odottaa versiota, joka sopii tähän sovelluksen versioon.");
    expect(addOnLine({ state: "refused", reason: "signature does not verify" })).toBe("Hylätty: allekirjoitus ei täsmää.");
    expect(addOnLine({ state: "refused", reason: "the code does not open the releases" })).toBe("Hylätty: koodi ei avaa julkaisuja.");
    expect(addOnLine({ state: "refused", reason: "the release service did not answer" })).toBe("Hylätty: julkaisua ei saatu haettua.");
    expect(addOnLine({ state: "refused", reason: "tar has a file with a name that is not plain" })).toBe("Hylätty: paketin sisältö ei kelpaa.");
  });
});

describe("the pages of an add-on", () => {
  it("are the entries that have one, in the order they were added", () => {
    const list: WebExtension[] = [{ id: "a", page: { label: "A", component: () => null } }, { id: "b" }, { id: "c", page: { label: "C", component: () => null } }];
    expect(extensionPages(list).map((e) => e.id)).toEqual(["a", "c"]);
    expect(extensionPages()).toEqual([]);
  });
});
