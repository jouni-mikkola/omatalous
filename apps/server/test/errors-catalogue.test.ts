import { describe, expect, it } from "vitest";
import { coded, errorBody, tooManyBody, UserError } from "../src/platform/errors.ts";

describe("coded errors", () => {
  it("keep the sentence beside the code, for older clients", () => {
    const err = UserError.of("check.sync_count", { max: 4 });
    expect(err.message).toBe("Valitse enintään 4 hakuaikaa.");
    expect(errorBody(err.message, err.info)).toEqual({ error: "Valitse enintään 4 hakuaikaa.", messageCode: "check.sync_count", params: { max: 4 } });
    expect(coded("auth.bad_login")).toEqual({ error: "Väärä käyttäjätunnus tai salasana.", messageCode: "auth.bad_login" });
    expect(tooManyBody(90)).toMatchObject({ messageCode: "auth.too_many", params: { minutes: 2 } });
  });

  it("leave a plain UserError as it was", () => {
    expect(errorBody(new UserError("x").message, new UserError("x").info)).toEqual({ error: "x" });
  });
});
