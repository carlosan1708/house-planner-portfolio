export const ragProjectIds = () => [...new Set((process.env.HOUSE_PLANNER_RAG_PROJECT_IDS ?? "").split(/[\s,]+/).filter((id) => /^[\w-]{1,160}$/.test(id)))];
export const ragEnabled = (projectId: string) => ragProjectIds().includes(projectId);
