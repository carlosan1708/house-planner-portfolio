import AuthGateway from "./AuthGateway";
import { getSessionMember, publicMember } from "@/lib/auth";
import { notFound } from "next/navigation";
import { parseWorkspaceRoute, readWorkspaceDestination } from "@/lib/workspace-navigation";

export const dynamic = "force-dynamic";

export default async function Home({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const member = await getSessionMember();
  const query = await searchParams;
  const url = new URL("http://workspace.local/");
  for (const [key, value] of Object.entries(query)) if (typeof value === "string") url.searchParams.set(key, value);
  // A root capability names its project in the server-side grant. The user's
  // currently selected workspace must not become an implicit requested project.
  const rootAccessLink = typeof query.accessLink === "string" && !query.project;
  if (rootAccessLink && query.section && !parseWorkspaceRoute("access-link", [typeof query.section === "string" ? query.section : ""])) notFound();
  const destination = readWorkspaceDestination(url, rootAccessLink ? undefined : member?.projectId);
  if (!rootAccessLink && (query.project || query.section) && !destination && (query.project || member)) notFound();
  return <AuthGateway initialUser={publicMember(member)} initialDestination={destination} initialMode={query.mode === "demo" ? "demo" : "default"} initialInvite={typeof query.invite === "string" ? query.invite : ""} initialAccessLink={typeof query.accessLink === "string" ? query.accessLink : ""} initialLanguage={query.lang === "es" || query.lang === "en" ? query.lang : undefined} />;
}
