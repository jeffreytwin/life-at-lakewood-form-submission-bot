// What has to be true before a queued change goes to the site, beyond a
// person saying yes. No IO here.

/**
 * Why a change cannot be approved yet, or null when it can. A base plan
 * needs its score first (Jeff, 2026-09-19: the sites list high scores
 * first and low ones last; the freelancers used 1 to 10). A quick move-in
 * carries no score, so it needs none; a removal needs nothing.
 */
export function approvalBlocker(changeType: string, record: unknown): string | null {
  if (changeType === "remove") return null;
  const rec = (record ?? null) as { quickMoveIn?: boolean; score?: unknown } | null;
  if (!rec) return "no proposed record to approve";
  if (rec.quickMoveIn === true) return null;
  return typeof rec.score === "number" && Number.isFinite(rec.score)
    ? null
    : "needs a score before approval (set it in the edit overlay)";
}
