import { readFile } from "node:fs/promises";
import { google, type sheets_v4 } from "googleapis";

let cached: sheets_v4.Sheets | null = null;

function loadCredentialsJson(): Promise<Record<string, unknown>> {
  const inline = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (inline) {
    return Promise.resolve(JSON.parse(inline) as Record<string, unknown>);
  }
  const path = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!path) {
    throw new Error("Manca GOOGLE_APPLICATION_CREDENTIALS o GOOGLE_SERVICE_ACCOUNT_JSON");
  }
  return readFile(path, "utf-8").then((t) => JSON.parse(t) as Record<string, unknown>);
}

/** Client Sheets condiviso (service account, scope spreadsheets). */
export async function getSheetsClient(): Promise<sheets_v4.Sheets> {
  if (cached) return cached;
  const keys = await loadCredentialsJson();
  const auth = new google.auth.GoogleAuth({
    credentials: keys,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  cached = google.sheets({ version: "v4", auth });
  return cached;
}
