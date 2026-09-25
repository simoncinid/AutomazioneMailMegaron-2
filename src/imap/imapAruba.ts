import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import type { ParsedInboundEmail } from "../domain/types.js";

export interface ImapFetchOptions {
  host: string;
  port: number;
  user: string;
  password: string;
  secure: boolean;
  /** Finestra temporale in ore. */
  lookbackHours: number;
  limit: number;
}

function toAddressText(
  value: { text: string } | Array<{ text: string }> | undefined,
): string | undefined {
  if (!value) return undefined;
  if (Array.isArray(value)) return value.map((v) => v.text).filter(Boolean).join(", ");
  return value.text;
}

function lookbackDate(hours: number): Date {
  return new Date(Date.now() - hours * 60 * 60 * 1000);
}

/**
 * Tutti i messaggi della INBOX con `INTERNALDATE >= now - lookbackHours`,
 * limitati agli ultimi `limit` UID.
 *
 * Il valore restituito espone `messageId = "imap-uid-<UID>"` quando il
 * Message-ID originale manca, in modo da poter usare l'UID nei log STDOUT.
 */
export async function listInboxMessagesFromImap(
  options: ImapFetchOptions,
): Promise<ParsedInboundEmail[]> {
  const client = new ImapFlow({
    host: options.host,
    port: options.port,
    secure: options.secure,
    auth: { user: options.user, pass: options.password },
  });

  await client.connect();
  const lock = await client.getMailboxLock("INBOX");
  try {
    const since = lookbackDate(options.lookbackHours);
    // Senza `{ uid: true }` imapflow usa SEARCH (numeri di sequenza), non UID SEARCH.
    // Quei numeri venivano poi passati a UID FETCH → fetch vuoti e 0 mail da elaborare
    // (es. seq 432..445 con UIDNEXT ~26279).
    const uids = (await client.search({ since }, { uid: true })) || [];
    const selectedUids = uids.slice(-Math.max(1, options.limit));
    const out: ParsedInboundEmail[] = [];

    if (selectedUids.length === 0) {
      return out;
    }

    for await (const msg of client.fetch(
      selectedUids,
      {
        envelope: true,
        internalDate: true,
        source: true,
      },
      { uid: true },
    )) {
      if (!msg.source) continue;
      const parsed = await simpleParser(msg.source, {});
      const fromValue = parsed.from?.text ?? msg.envelope?.from?.[0]?.address ?? "";
      const internalReceivedAt = msg.internalDate
        ? new Date(msg.internalDate)
        : parsed.date
          ? new Date(parsed.date)
          : new Date();
      if (internalReceivedAt.getTime() < since.getTime()) continue;

      const receivedAt = internalReceivedAt;
      out.push({
        messageId: parsed.messageId ?? `imap-uid-${msg.uid}`,
        from: fromValue,
        fromDisplayName: parsed.from?.value?.[0]?.name ?? undefined,
        to: toAddressText(parsed.to) ?? undefined,
        subject: parsed.subject ?? "",
        receivedAt,
        textBody: parsed.text ?? "",
        htmlBody: typeof parsed.html === "string" ? parsed.html : undefined,
      });
    }

    return out;
  } finally {
    lock.release();
    await client.logout();
  }
}
