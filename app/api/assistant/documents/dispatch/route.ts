import { advanceRagBackfill } from "@/lib/rag-backfill";
import { processRagProject } from "@/lib/rag-processing";
import { ragProjectIds } from "@/lib/rag-sources";
import { verifySchedulerRequest } from "@/lib/scheduler-auth";

export const runtime = "nodejs";
export const maxDuration = 180;

export async function POST(request: Request) {
  if (!await verifySchedulerRequest(request)) return Response.json({ error: "Scheduler authentication required" }, { status: 401 });
  const projects = ragProjectIds();
  const deadline = Date.now() + 90_000;
  // Rotate the first project each minute so busy projects cannot starve other queues.
  const first = Math.floor(Date.now() / 60_000) % projects.length;
  const counts = { steps: 0, errors: 0 };
  for (const projectId of [...projects.slice(first), ...projects.slice(0, first)]) {
    if (Date.now() >= deadline) break;
    try {
      const result = await processRagProject(projectId, Math.min(deadline, Date.now() + 20_000));
      counts.steps += result.steps;
      counts.errors += result.errors;
      await advanceRagBackfill(projectId);
    } catch {
      counts.errors += 1;
    }
  }
  if (counts.steps || counts.errors) console.info("Assistant index dispatch", counts);
  return Response.json(counts);
}
