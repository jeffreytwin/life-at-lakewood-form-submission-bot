import { describe, it, expect } from "vitest";
import { describeCoverage } from "@/lib/floorplans/coverage";
import { attentionDismissed, troubledConnections } from "@/lib/floorplans/health";

describe("attentionDismissed", () => {
  it("holds while the dismissal is newer than the last run, and lapses when a newer run fails", () => {
    expect(attentionDismissed({ attention_dismissed_at: null, last_run_at: "2026-09-21T18:00:00Z" })).toBe(false);
    expect(attentionDismissed({ attention_dismissed_at: "2026-09-21T18:05:00Z", last_run_at: "2026-09-21T18:00:00Z" })).toBe(true);
    expect(attentionDismissed({ attention_dismissed_at: "2026-09-21T18:05:00Z", last_run_at: "2026-09-21T19:00:00Z" })).toBe(false);
    expect(attentionDismissed({ attention_dismissed_at: "2026-09-21T18:05:00Z", last_run_at: null })).toBe(true);
  });
});

describe("describeCoverage", () => {
  it("accepts a first run, a steady count, and a modest drop", () => {
    expect(describeCoverage(16, null).ok).toBe(true);
    expect(describeCoverage(16, 16).ok).toBe(true);
    expect(describeCoverage(10, 16).ok).toBe(true);
  });

  it("flags a run that found far fewer plans than last time, and says so in the status", () => {
    const c = describeCoverage(3, 16);
    expect(c.ok).toBe(false);
    expect(c.detail).toMatch(/^partial: 3 of the 16 plans/);
    expect(c.detail).toMatch(/removals held/);
  });
});

describe("troubledConnections", () => {
  const builders = [
    {
      name: "Toll Brothers",
      active: true,
      fp_builder_communities: [
        { id: "a", active: true, last_run_at: "2026-09-19T18:10:00Z", last_run_status: "zero results (treated as failure)", consecutive_failures: 3, fp_communities: { name: "The Isles", fp_sites: { domain: "lifeatlakewood.com" } } },
        { id: "b", active: true, last_run_at: "2026-09-19T18:10:00Z", last_run_status: "ok: 12 plans, 0 changes queued", consecutive_failures: 0, fp_communities: { name: "Monterey", fp_sites: { domain: "lifeatlakewood.com" } } },
        { id: "e", active: true, last_run_at: "2026-09-19T18:10:00Z", last_run_status: "error: 500", consecutive_failures: 2, attention_dismissed_at: "2026-09-19T18:30:00Z", fp_communities: { name: "Dismissed Place", fp_sites: { domain: "lifeatlakewood.com" } } },
        { id: "c", active: false, last_run_at: null, last_run_status: "error: 403", consecutive_failures: 5, fp_communities: { name: "Paused Place", fp_sites: { domain: "lifeatlakewood.com" } } },
      ],
    },
    {
      name: "Lennar",
      active: true,
      fp_builder_communities: [
        { id: "d", active: true, last_run_at: "2026-09-19T18:12:00Z", last_run_status: "partial: 3 of the 16 plans found last time (removals held; check the builder's page); 1 changes queued", consecutive_failures: 1, fp_communities: { name: "Lorraine Lakes", fp_sites: { domain: "lifeatlakewood.com" } } },
      ],
    },
    {
      name: "Paused Builder",
      active: false,
      fp_builder_communities: [
        { id: "e", active: true, last_run_at: null, last_run_status: "error: boom", consecutive_failures: 9, fp_communities: null },
      ],
    },
  ];

  it("lists active connections of active builders whose last run failed, worst first", () => {
    const t = troubledConnections(builders);
    expect(t.map((x) => x.id)).toEqual(["a", "d"]);
    expect(t[0]).toMatchObject({ builder: "Toll Brothers", community: "The Isles", domain: "lifeatlakewood.com", failures: 3 });
    expect(t[1].status).toMatch(/^partial/);
  });

  it("is empty when every run succeeded", () => {
    expect(troubledConnections([{ name: "X", active: true, fp_builder_communities: [] }])).toEqual([]);
  });
});
