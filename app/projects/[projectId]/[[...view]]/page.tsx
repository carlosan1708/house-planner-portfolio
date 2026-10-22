import { notFound } from "next/navigation";
import AuthGateway from "@/app/AuthGateway";
import { getSessionMember, publicMember } from "@/lib/auth";
import { parseWorkspaceRoute } from "@/lib/workspace-navigation";

export const dynamic = "force-dynamic";

export default async function ProjectView({ params, searchParams }: {
  params: Promise<{ projectId: string; view?: string[] }>;
  searchParams: Promise<{ mode?: string | string[]; invite?: string | string[]; accessLink?: string | string[]; lang?: string | string[] }>;
}) {
  const route = await params;
  const destination = parseWorkspaceRoute(route.projectId, route.view);
  if (!destination) notFound();
  const [member, query] = await Promise.all([getSessionMember(), searchParams]);
  return <AuthGateway
    initialUser={publicMember(member)}
    initialMode={query.mode === "demo" ? "demo" : "default"}
    initialInvite={typeof query.invite === "string" ? query.invite : ""}
    initialAccessLink={typeof query.accessLink === "string" ? query.accessLink : ""}
    initialLanguage={query.lang === "es" || query.lang === "en" ? query.lang : undefined}
    initialDestination={destination}
  />;
}
