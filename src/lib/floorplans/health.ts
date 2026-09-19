// Which builder connections need a person's attention, from the builders
// list the Hub already loads: every active connection whose last run
// failed (an error, no plans, or far fewer plans than last time, see
// coverage.ts). Shown as a banner on the Floor Plans page, since that is
// the page a person opens; the details live in Settings → Builder
// Connections. No IO here.

export interface ConnectionHealthInput {
  id: string;
  active: boolean;
  last_run_at: string | null;
  last_run_status: string | null;
  consecutive_failures: number;
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

/** Active connections of active builders whose last run failed, worst first. */
export function troubledConnections(builders: BuilderHealthInput[]): TroubledConnection[] {
  const out: TroubledConnection[] = [];
  for (const b of builders) {
    if (!b.active) continue;
    for (const c of b.fp_builder_communities ?? []) {
      if (!c.active || !(c.consecutive_failures > 0)) continue;
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
