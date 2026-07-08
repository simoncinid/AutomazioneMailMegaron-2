import { describe, expect, it } from "vitest";
import { isRetryableGoogleSheetsError } from "../src/sheets/googleSheetsOperation.js";

describe("isRetryableGoogleSheetsError", () => {
  it("riconosce la chiusura prematura dello stream OAuth Google", () => {
    const error = {
      code: "ERR_STREAM_PREMATURE_CLOSE",
      message:
        "Invalid response body while trying to fetch https://www.googleapis.com/oauth2/v4/token: Premature close",
      config: { url: "https://www.googleapis.com/oauth2/v4/token" },
      error: {
        code: "ERR_STREAM_PREMATURE_CLOSE",
        message: "Premature close",
      },
    };

    expect(isRetryableGoogleSheetsError(error)).toBe(true);
  });

  it("non ritenta errori applicativi non transitori", () => {
    const error = {
      code: 400,
      message: "Unable to parse range",
      response: { status: 400 },
    };

    expect(isRetryableGoogleSheetsError(error)).toBe(false);
  });
});
