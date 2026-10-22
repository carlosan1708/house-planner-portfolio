export type CountdownRecord = {
  id: string;
  title: string;
  durationDays: number;
  startedAt: string;
  dueAt: string;
  acknowledged: boolean;
  completed?: boolean;
  completedAt?: string | null;
  createdBy: string;
  recipientUids: string[];
  notifyCurrentUser: boolean;
};

export function normalizeCountdownDays(value: unknown) {
  const days = Math.round(Number(value));
  return Number.isFinite(days) ? Math.min(365, Math.max(1, days)) : 10;
}

export function countdownTiming(item: Pick<CountdownRecord, "startedAt" | "dueAt">, now = Date.now()) {
  const startedAt = new Date(item.startedAt).getTime();
  const dueAt = new Date(item.dueAt).getTime();
  const total = Math.max(1, dueAt - startedAt);
  const remaining = dueAt - now;
  const totalDays = Math.ceil(total / 86_400_000);
  return {
    due: remaining <= 0,
    daysRemaining: Math.max(0, Math.min(totalDays, Math.ceil(remaining / 86_400_000))),
    progress: Math.max(0, Math.min(100, ((now - startedAt) / total) * 100)),
  };
}

/** Acknowledgement silences only the current user; completion finishes the shared task. */
export function countdownNeedsAttention(item: CountdownRecord, now = Date.now()) {
  return !item.completed && item.notifyCurrentUser && !item.acknowledged && countdownTiming(item, now).due;
}
