import "dotenv/config";

/**
 * Entrypoint HTTP.
 *
 * Stack runtime: Node.js 20+ (consigliato su Render/Fly/simili).
 * Dipendenze principali: Express (webhook ingresso email), pino (log),
 * googleapis (Sheets API), pg (opzionale se LISTING_SOURCE=database).
 *
 * Variabili d'ambiente: vedere `.env.example` e README.
 */
import { bootstrapEnv } from "./config/loadEnv.js";
import { createApp } from "./http/createApp.js";
import { logger } from "./logging/logger.js";

const env = await bootstrapEnv();
const app = createApp(env);
const port = env.PORT;

app.listen(port, () => {
  logger.info({ port }, "Server in ascolto");
});
