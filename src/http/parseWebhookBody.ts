import type { ParsedInboundEmail } from "../domain/types.js";

/**
 * SendGrid Inbound Parse: campi tipici `from`, `subject`, `text`, `html`, `headers`
 * @see https://docs.sendgrid.com/for-developers/parsing-email/setting-up-the-inbound-parse-webhook
 *
 * Mailgun Routes: `sender`, `subject`, `body-plain`, `body-html`
 * @see https://documentation.mailgun.com/docs/mailgun/user-manual/receive-forward-store/
 *
 * Payload generico JSON (test): { from, subject, text, html }
 */
export function parseGenericJson(body: Record<string, unknown>): ParsedInboundEmail {
  const from = String(body.from ?? body.sender ?? body.From ?? "");
  const subject = String(body.subject ?? body.Subject ?? "");
  const textBody = String(
    body.text ?? body["body-plain"] ?? body.textBody ?? "",
  );
  const htmlBody = body.html ?? body["body-html"] ?? body.htmlBody;
  const receivedAt = new Date();
  const messageId =
    (body["message-id"] as string) ||
    (body.MessageID as string) ||
    undefined;

  return {
    messageId,
    from,
    subject,
    receivedAt,
    textBody,
    htmlBody: htmlBody != null ? String(htmlBody) : undefined,
  };
}
