import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import type { ParsedInboundEmail } from "../domain/types.js";

export interface ImapFetchOptions {
  host: string;
  port: number;
  user: string;
  password: string;
  secure: boolean;
  /** Finestra `SINCE` in giorni (allineato al test Python `IMAP_TEST_SINCE_DAYS`). */
  lookbackDays: number;
  limit: number;
}

function toAddressText(
  value: { text: string } | Array<{ text: string }> | undefined,
): string | undefined {
  if (!value) return undefined;
  if (Array.isArray(value)) return value.map((v) => v.text).filter(Boolean).join(", ");
  return value.text;
}

function lookbackDate(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

/**
 * Tutti i messaggi della INBOX con `INTERNALDATE >= now - lookbackDays`,
 * limitati agli ultimi `limit` UID (allineato a `test_imap_aruba.py`).
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
    const since = lookbackDate(options.lookbackDays);
    const uids = (await client.search({ since })) || [];
    const selectedUids = uids.slice(-Math.max(1, options.limit));
    const out: ParsedInboundEmail[] = [];

    for (const uid of selectedUids) {
      for await (const msg of client.fetch(
        { uid },
        {
          uid: true,
          envelope: true,
          internalDate: true,
          source: true,
        },
      )) {
        if (!msg.source) continue;
        const parsed = await simpleParser(msg.source, {});
        const fromValue = parsed.from?.text ?? msg.envelope?.from?.[0]?.address ?? "";
        const receivedAt = parsed.date
          ? new Date(parsed.date)
          : msg.internalDate
            ? new Date(msg.internalDate)
            : new Date();
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
    }

    return out;
  } finally {
    lock.release();
    await client.logout();
  }
}
