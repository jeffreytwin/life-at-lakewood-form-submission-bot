// Which builder connections need a person's attention, from the builders
// list the Hub already loads: every active connection whose last run
// failed (an error, no plans, or far fewer plans than last time, see
// coverage.ts). Shown as a banner on the Floor Plans page, since that is
// the page a person opens; the details live in Settings → Builder
// Connections. A dismissed one (Jeff, 2026-09-21) stays out of the banner
// until a newer run of it fails. No IO here.

export interface ConnectionHealthInput {
  id: string;
  active: boolean;
  last_run_at: string | null;
  last_run_status: string | null;
  consecutive_failures: number;
  /** When a person dismissed it from the banner; a failing run after that brings it back. */
  attention_dismissed_at?: string | null;
  fp_communities?: { name: string; fp_sites?: { domain: string } | null } | null;
}

export interface BuilderHealthInput {
  name: string;
  active: boolean;
  fp_builder_communities?: ConnectionHealthInput[];
}

export interface TroubledConnection {
  id: string;
  builder: string;
  community: string;
  domain: string;
  status: string | null;
  failures: number;
  lastRunAt: string | null;
}

/** Whether the connection's failure was dismissed after its last run. */
export function attentionDismissed(c: Pick<ConnectionHealthInput, "attention_dismissed_at" | "last_run_at">): boolean {
  if (!c.attention_dismissed_at) return false;
  if (!c.last_run_at) return true;
  return Date.parse(c.attention_dismissed_at) >= Date.parse(c.last_run_at);
}

/** Active connections of active builders whose last run failed and nobody dismissed, worst first. */
export function troubledConnections(builders: BuilderHealthInput[]): TroubledConnection[] {
  const out: TroubledConnection[] = [];
  for (const b of builders) {
    if (!b.active) continue;
    for (const c of b.fp_builder_communities ?? []) {
      if (!c.active || !(c.consecutive_failures > 0) || attentionDismissed(c)) continue;
      out.push({
        id: c.id,
        builder: b.name,
        community: c.fp_communities?.name ?? "?",
        domain: c.fp_communities?.fp_sites?.domain ?? "",
        status: c.last_run_status,
        failures: c.consecutive_failures,
        lastRunAt: c.last_run_at,
      });
    }
  }
  return out.sort((a, b) => b.failures - a.failures || a.builder.localeCompare(b.builder));
}
