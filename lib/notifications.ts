export type NotificationLanguage = "es" | "en";
export type NotificationStage = "pre_due" | "due";

export type NotificationJobSpec = {
  id: string;
  stage: NotificationStage;
  runAtMs: number;
};

const DAY_MS = 86_400_000;

export function normalizeRecipientUids(value: unknown) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((uid): uid is string => typeof uid === "string" && uid.length > 0 && uid.length <= 160))].slice(0, 100);
}

export function countdownJobSpecs(countdownId: string, startedAtMs: number, dueAtMs: number): NotificationJobSpec[] {
  const specs: NotificationJobSpec[] = [{ id: `${countdownId}__due`, stage: "due", runAtMs: dueAtMs }];
  if (dueAtMs - startedAtMs > DAY_MS) {
    specs.unshift({ id: `${countdownId}__pre_due`, stage: "pre_due", runAtMs: dueAtMs - DAY_MS });
  }
  return specs;
}

export function normalizeNotificationLanguage(value: unknown): NotificationLanguage {
  return value === "en" ? "en" : "es";
}

function cleanHeader(value: string) {
  return value.replace(/[\r\n]+/g, " ").trim();
}

function html(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
}

function encodedHeader(value: string) {
  return `=?UTF-8?B?${Buffer.from(cleanHeader(value), "utf8").toString("base64")}?=`;
}

export function reminderCopy({ language, projectName, title, dueAt, stage }: {
  language: NotificationLanguage;
  projectName: string;
  title: string;
  dueAt: Date;
  stage: NotificationStage;
}) {
  const locale = language === "es" ? "es-CR" : "en-US";
  const date = dueAt.toLocaleString(locale, { dateStyle: "medium", timeStyle: "short", timeZone: "America/Costa_Rica" });
  if (language === "en") {
    return {
      subject: stage === "pre_due" ? `Reminder tomorrow · ${title}` : `Due now · ${title}`,
      heading: stage === "pre_due" ? "This reminder is due in 24 hours" : "This reminder is due now",
      intro: `A countdown in ${projectName} needs your attention.`,
      dueLabel: `Due: ${date}`,
      action: "Open plan and schedule",
      footer: "You received this operational reminder because you were selected in the project countdown.",
    };
  }
  return {
    subject: stage === "pre_due" ? `Recordatorio para mañana · ${title}` : `Vence ahora · ${title}`,
    heading: stage === "pre_due" ? "Este recordatorio vence en 24 horas" : "Este recordatorio vence ahora",
    intro: `Una cuenta regresiva de ${projectName} necesita tu atención.`,
    dueLabel: `Vence: ${date}`,
    action: "Abrir plan y cronograma",
    footer: "Recibiste este recordatorio operativo porque fuiste seleccionado en la cuenta regresiva del proyecto.",
  };
}

export function buildGmailMessage({ from, to, projectName, title, dueAt, stage, language, link, deliveryId }: {
  from: string;
  to: string;
  projectName: string;
  title: string;
  dueAt: Date;
  stage: NotificationStage;
  language: NotificationLanguage;
  link: string;
  deliveryId: string;
}) {
  const copy = reminderCopy({ language, projectName, title, dueAt, stage });
  const safeTitle = html(title);
  const safeProject = html(projectName);
  const safeLink = html(link);
  const text = `${copy.heading}\n\n${copy.intro}\n${title}\n${copy.dueLabel}\n\n${copy.action}: ${link}\n\n${copy.footer}`;
  const body = `<!doctype html><html lang="${language}"><body style="margin:0;background:#f4f5f8;font-family:Arial,sans-serif;color:#24252b"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:620px;background:#fff;border:1px solid #e2e3e9;border-radius:16px;overflow:hidden"><tr><td style="padding:18px 24px;background:#24252b;color:#fff;font-weight:700">House Planner</td></tr><tr><td style="padding:30px 24px"><div style="font-size:12px;color:#6677f5;font-weight:700;text-transform:uppercase">${safeProject}</div><h1 style="font:500 28px Georgia,serif;margin:10px 0 16px">${html(copy.heading)}</h1><p style="color:#656873;line-height:1.6">${html(copy.intro)}</p><div style="margin:22px 0;padding:18px;border-radius:12px;background:#f7f7fb"><strong style="display:block;font-size:17px">${safeTitle}</strong><span style="display:block;margin-top:8px;color:#767985">${html(copy.dueLabel)}</span></div><a href="${safeLink}" style="display:inline-block;padding:12px 18px;border-radius:9px;background:#596bec;color:#fff;text-decoration:none;font-weight:700">${html(copy.action)}</a><p style="margin:28px 0 0;color:#92949e;font-size:12px;line-height:1.5">${html(copy.footer)}</p></td></tr></table></td></tr></table></body></html>`;
  const boundary = `house-planner-${deliveryId.replace(/[^a-zA-Z0-9]/g, "").slice(0, 48)}`;
  const message = [
    `From: House Planner <${cleanHeader(from)}>`,
    `To: ${cleanHeader(to)}`,
    `Subject: ${encodedHeader(copy.subject)}`,
    `Message-ID: <${cleanHeader(deliveryId)}@example-house-planner>`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from(text, "utf8").toString("base64"),
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from(body, "utf8").toString("base64"),
    `--${boundary}--`,
  ].join("\r\n");
  return Buffer.from(message, "utf8").toString("base64url");
}
