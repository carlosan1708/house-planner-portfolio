export function nextDraftRevision(currentRevision: number, suppliedRevision: number, status: string) {
  if (status !== "editing") return { ok: false as const, reason: "frozen" as const };
  if (currentRevision !== suppliedRevision) return { ok: false as const, reason: "revision_conflict" as const };
  return { ok: true as const, revision: currentRevision + 1 };
}

export function canPromoteDraft(basePlanVersion: number, currentPlanVersion: number) {
  return basePlanVersion === currentPlanVersion;
}

export function canCommitWorkbookVersion(loadedPlanVersion: number, currentPlanVersion: number, loadedActualsRevision: number, currentActualsRevision: number) {
  return loadedPlanVersion === currentPlanVersion && loadedActualsRevision === currentActualsRevision;
}
