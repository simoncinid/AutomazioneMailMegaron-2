import type { ParsedInboundEmail } from "../domain/types.js";
import type { GraphMessageDetail } from "./microsoftGraph.js";

/** Rimuove tag HTML basilare per estrarre testo dal corpo Graph. */
function htmlToPlain(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function graphMessageToParsedEmail(msg: GraphMessageDetail): ParsedInboundEmail {
  const addr = msg.from?.emailAddress?.address ?? "";
  const name = msg.from?.emailAddress?.name?.trim();
  const receivedAt = msg.receivedDateTime
    ? new Date(msg.receivedDateTime)
    : new Date();
  const contentType = msg.body?.contentType?.toLowerCase() ?? "";
  const raw = msg.body?.content ?? "";
  let textBody = "";
  let htmlBody: string | undefined;
  if (contentType.includes("html")) {
    htmlBody = raw;
    textBody = htmlToPlain(raw);
  } else {
    textBody = raw;
  }
  return {
    messageId: msg.id,
    from: addr,
    fromDisplayName: name || undefined,
    subject: msg.subject ?? "",
    receivedAt,
    textBody,
    htmlBody,
  };
}
