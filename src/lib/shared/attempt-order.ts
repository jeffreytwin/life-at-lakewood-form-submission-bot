/**
 * Sort a lead's routing attempts newest first.
 *
 * Attempt numbers restart at 1 every time a lead is retried from the
 * dashboard (see getMaxAttemptNumber, which scopes the counter to the
 * current retry cycle). Across cycles the highest number is therefore not
 * the latest attempt — the old cycle's #3 outranks the new cycle's #1 —
 * and anything that reads "newest" off the number names the wrong agent.
 * Creation time is what actually orders them; the number only breaks ties
 * between rows stamped in the same instant, or when a row carries no time.
 */
export function attemptsNewestFirst<
  T extends { attempt_number: number; created_at?: string | null },
>(attempts: T[] | null | undefined): T[] {
  return [...(attempts ?? [])].sort((a, b) => {
    const byTime = timeOf(b) - timeOf(a);
    return byTime !== 0 ? byTime : b.attempt_number - a.attempt_number;
  });
}

function timeOf(attempt: { created_at?: string | null }): number {
  if (!attempt.created_at) return 0;
  const t = Date.parse(attempt.created_at);
  return Number.isNaN(t) ? 0 : t;
}
