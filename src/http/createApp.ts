import express from "express";
import type { AppEnv } from "../config/loadEnv.js";
import { logger } from "../logging/logger.js";
import { createListingRepository } from "../repositories/createListingRepository.js";
import { GoogleSheetsWriter } from "../sheets/googleSheetsWriter.js";
import { processInboundEmail } from "../services/leadProcessor.js";
import { parseGenericJson } from "./parseWebhookBody.js";

const log = logger.child({ module: "http" });

export function createApp(env: AppEnv): express.Application {
  const app = express();

  app.use(express.json({ limit: "2mb" }));
  app.use(
    express.urlencoded({ extended: true, limit: "2mb" }),
  );

  app.get("/health", (_req, res) => {
    res.json({ ok: true, service: "automazione-mail-megaron" });
  });

  const sheets = new GoogleSheetsWriter();
  const listings = createListingRepository(env);

  const extraIdPatterns = env.EXTRA_ID_REGEX
    ? env.EXTRA_ID_REGEX.split("|").map((s) => s.trim()).filter(Boolean)
    : undefined;

  app.post("/webhooks/inbound-email", async (req, res) => {
    try {
      const body =
        typeof req.body === "object" && req.body !== null
          ? (req.body as Record<string, unknown>)
          : {};
      const email = parseGenericJson(body);
      await processInboundEmail(email, {
        env,
        listings,
        sheets,
        extraIdPatterns,
      });
      res.status(200).json({ ok: true });
    } catch (e) {
      log.error({ err: e }, "Errore elaborazione webhook email");
      res.status(500).json({
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  });

  return app;
}
