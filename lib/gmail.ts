import "server-only";
import { OAuth2Client } from "google-auth-library";

export function gmailConfiguration() {
  const clientId = process.env.HOUSE_PLANNER_GMAIL_CLIENT_ID?.trim() || "";
  const clientSecret = process.env.HOUSE_PLANNER_GMAIL_CLIENT_SECRET?.trim() || "";
  const refreshToken = process.env.HOUSE_PLANNER_GMAIL_REFRESH_TOKEN?.trim() || "";
  const sender = process.env.HOUSE_PLANNER_GMAIL_SENDER?.trim().toLowerCase() || "";
  return { clientId, clientSecret, refreshToken, sender, configured: Boolean(clientId && clientSecret && refreshToken && sender) };
}

export async function sendGmailMessage(raw: string) {
  const config = gmailConfiguration();
  if (!config.configured) throw new Error("gmail-not-configured");
  const client = new OAuth2Client(config.clientId, config.clientSecret);
  client.setCredentials({ refresh_token: config.refreshToken });
  const response = await client.request<{ id?: string }>({
    url: "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
    method: "POST",
    data: { raw },
  });
  if (!response.data.id) throw new Error("gmail-missing-message-id");
  return response.data.id;
}
