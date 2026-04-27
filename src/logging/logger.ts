import pino from "pino";

const isDev = process.env.NODE_ENV !== "production";

/**
 * Logger principale: tutto su STDERR (fd 2). STDOUT è riservato al blocco
 * "campi OpenAI" per ogni email (vedi `printOpenAiExtractionBlock`).
 */
export const logger = isDev
  ? pino(
      {
        level: process.env.LOG_LEVEL ?? "info",
      },
      pino.transport({
        target: "pino-pretty",
        options: { colorize: true, translateTime: "SYS:standard", destination: 2 },
      }),
    )
  : pino(
      {
        level: process.env.LOG_LEVEL ?? "info",
      },
      pino.destination(2),
    );

/**
 * Stampa su STDOUT (uno e uno solo per email) i 4 campi estratti da OpenAI,
 * stesso layout del test Python `test_imap_aruba.py`.
 */
export function printOpenAiExtractionBlock(
  index: number | null,
  total: number | null,
  uid: string,
  fields: { nome: string; cognome: string; email: string; idAnnuncio: string },
): void {
  const fmt = (v: string): string => {
    const s = (v ?? "").trim();
    return s.length > 0 ? s : "—";
  };
  const header =
    index != null && total != null ? `--- ${index}/${total}  UID ${uid} ---` : `--- UID ${uid} ---`;
  process.stdout.write(`${header}\n`);
  process.stdout.write(`nome:         ${fmt(fields.nome)}\n`);
  process.stdout.write(`cognome:      ${fmt(fields.cognome)}\n`);
  process.stdout.write(`email:        ${fmt(fields.email)}\n`);
  process.stdout.write(`id_annuncio:  ${fmt(fields.idAnnuncio)}\n`);
  process.stdout.write("\n");
}
