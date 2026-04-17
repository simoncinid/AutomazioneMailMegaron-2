import type { ParsedInboundEmail } from "../domain/types.js";

/**
 * Contratto per ingressi email diversi (IMAP, SendGrid, Mailgun, forwarding HTTP).
 * L'implementazione concreta trasforma il payload nativo in ParsedInboundEmail.
 */
export interface EmailProvider {
  /** Nome per log/diagnostica */
  readonly name: string;
}

/** Callback usata dal webhook HTTP dopo il parse. */
export type EmailHandler = (email: ParsedInboundEmail) => Promise<void>;

/**
 * Placeholder per futuro worker IMAP (node-imap o simile).
 * Non implementato: espone solo la forma dell'API.
 */
export interface ImapEmailProvider extends EmailProvider {
  startPolling(_onMail: EmailHandler): Promise<void>;
  stop(): Promise<void>;
}

export class NotImplementedImapProvider implements ImapEmailProvider {
  readonly name = "imap-stub";

  async startPolling(_onMail: EmailHandler): Promise<void> {
    throw new Error(
      "ImapEmailProvider non implementato: configurare IMAP_* e usare un worker dedicato",
    );
  }

  async stop(): Promise<void> {
    /* noop */
  }
}
