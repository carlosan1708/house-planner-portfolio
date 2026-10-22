import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import { requireTabAccess } from "@/lib/auth";
import { firestore } from "@/lib/firebase-admin";
import { gmailConfiguration } from "@/lib/gmail";
import { eligibleCountdownRecipients } from "@/lib/notification-service";
import { normalizeNotificationLanguage } from "@/lib/notifications";
import { NOTIFICATION_PREFERENCES, USERS } from "@/lib/project";

export async function GET() {
  const actor = await requireTabAccess("plan");
  if (!actor || actor.isPersonal || actor.anonymousLink) return NextResponse.json({ error: "Plan account access required" }, { status: 403 });
  const [recipients, preference] = await Promise.all([
    eligibleCountdownRecipients(actor.projectId),
    firestore.collection(NOTIFICATION_PREFERENCES).doc(actor.uid).get(),
  ]);
  return NextResponse.json({
    configured: gmailConfiguration().configured,
    sender: gmailConfiguration().sender,
    emailEnabled: preference.data()?.emailEnabled !== false,
    language: normalizeNotificationLanguage(preference.data()?.language),
    recipients: recipients.sort((a, b) => a.name.localeCompare(b.name)),
  });
}

export async function PATCH(request: Request) {
  const actor = await requireTabAccess("plan");
  if (!actor || actor.isPersonal || actor.anonymousLink) return NextResponse.json({ error: "Plan account access required" }, { status: 403 });
  const body = await request.json().catch(() => ({})) as { emailEnabled?: unknown; language?: unknown };
  const updates: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() };
  if (typeof body.emailEnabled === "boolean") updates.emailEnabled = body.emailEnabled;
  if (body.language === "es" || body.language === "en") updates.language = body.language;
  const writes: Promise<unknown>[] = [firestore.collection(NOTIFICATION_PREFERENCES).doc(actor.uid).set(updates, { merge: true })];
  if (body.language === "es" || body.language === "en") {
    writes.push(firestore.collection(USERS).doc(actor.uid).set({ notificationLanguage: body.language, updatedAt: FieldValue.serverTimestamp() }, { merge: true }));
  }
  await Promise.all(writes);
  return NextResponse.json({ ok: true, emailEnabled: updates.emailEnabled, language: updates.language });
}
