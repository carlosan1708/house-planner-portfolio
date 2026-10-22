import { getChatGPTUser } from "./chatgpt-auth";

export type ProjectRole = "admin" | "editor" | "viewer";

export async function getProjectActor() {
  const user = await getChatGPTUser();
  if (!user && process.env.NODE_ENV === "development") {
    return {
      user: { userId: "local-owner", displayName: "Local owner", email: "owner@local.test", fullName: "Local owner" },
      role: "admin" as const,
    };
  }
  if (!user) return null;

  const adminEmail = process.env.HOUSE_PLANNER_ADMIN_EMAIL?.trim().toLowerCase();
  const role: ProjectRole = !adminEmail || user.email.toLowerCase() === adminEmail ? "admin" : "editor";
  return { user, role };
}
