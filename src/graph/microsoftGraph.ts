import { logger } from "../logging/logger.js";

const log = logger.child({ module: "microsoftGraph" });

export interface GraphTokenResponse {
  access_token: string;
  expires_in: number;
}

let cachedToken: { token: string; expiresAt: number } | null = null;

/**
 * Client credentials — stesso flusso di JospaAutomation (Azure AD app).
 * Scope: https://graph.microsoft.com/.default
 */
export async function getGraphAccessToken(params: {
  tenantId: string;
  clientId: string;
  clientSecret: string;
}): Promise<string> {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt > now + 60_000) {
    return cachedToken.token;
  }
  const url = `https://login.microsoftonline.com/${params.tenantId}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: params.clientId,
    client_secret: params.clientSecret,
    scope: "https://graph.microsoft.com/.default",
  });
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Graph token ${res.status}: ${t}`);
  }
  const json = (await res.json()) as GraphTokenResponse;
  cachedToken = {
    token: json.access_token,
    expiresAt: now + (json.expires_in ?? 3600) * 1000,
  };
  log.debug("Token Graph ottenuto");
  return json.access_token;
}

export interface GraphMessageListItem {
  id: string;
  subject?: string;
  receivedDateTime?: string;
  from?: {
    emailAddress?: { address?: string; name?: string };
  };
}

interface GraphMessagesResponse {
  value: GraphMessageListItem[];
  "@odata.nextLink"?: string;
}

export interface GraphMessageBody {
  contentType?: string;
  content?: string;
}

export interface GraphMessageDetail extends GraphMessageListItem {
  body?: GraphMessageBody;
}

/**
 * Elenco messaggi in Inbox da una certa data (ISO 8601).
 * Permessi app: Mail.Read (application) + admin consent sul tenant.
 */
export async function listInboxMessagesSince(params: {
  accessToken: string;
  mailboxUser: string;
  sinceIso: string;
  top?: number;
}): Promise<GraphMessageListItem[]> {
  const base = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(params.mailboxUser)}/mailFolders/inbox/messages`;
  const q = new URLSearchParams({
    $filter: `receivedDateTime ge ${params.sinceIso}`,
    $orderby: "receivedDateTime desc",
    $select: "id,subject,from,receivedDateTime",
    $top: String(params.top ?? 50),
  });
  const out: GraphMessageListItem[] = [];
  let next: string | undefined = `${base}?${q.toString()}`;
  while (next) {
    const res = await fetch(next, {
      headers: { Authorization: `Bearer ${params.accessToken}` },
    });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`Graph list messages ${res.status}: ${t}`);
    }
    const data = (await res.json()) as GraphMessagesResponse;
    out.push(...(data.value ?? []));
    next = data["@odata.nextLink"];
  }
  return out;
}

export async function getMessageDetail(params: {
  accessToken: string;
  mailboxUser: string;
  messageId: string;
}): Promise<GraphMessageDetail> {
  const url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(params.mailboxUser)}/messages/${encodeURIComponent(params.messageId)}?$select=id,subject,from,receivedDateTime,body`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${params.accessToken}` },
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Graph get message ${res.status}: ${t}`);
  }
  return (await res.json()) as GraphMessageDetail;
}
