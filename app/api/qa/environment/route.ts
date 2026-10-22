import { NextResponse } from "next/server";
import { assertIsolatedQaEnvironment, QA_ISOLATION_PROJECT, QA_PRIMARY_PROJECT } from "@/lib/qa-environment.mjs";
import { QA_FIXTURE_VERSION } from "@/lib/qa-fixtures.mjs";
import { qaAiPolicy } from "@/lib/qa-ai-policy";

export const runtime = "nodejs";

export async function GET() {
  try {
    const config = assertIsolatedQaEnvironment();
    return NextResponse.json({
      environment: "qa", isolated: true, emulator: config.isEmulator,
      cloudProjectId: config.projectId, primaryProjectId: QA_PRIMARY_PROJECT, isolationProjectId: QA_ISOLATION_PROJECT,
      service: process.env.K_SERVICE || "local", revision: process.env.K_REVISION || "local",
      sourceCommit: process.env.HOUSE_PLANNER_SOURCE_COMMIT || "", sourceTree: process.env.HOUSE_PLANNER_SOURCE_TREE || "",
      fixtureVersion: QA_FIXTURE_VERSION, ai: qaAiPolicy(),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404, headers: { "Cache-Control": "no-store" } });
  }
}
