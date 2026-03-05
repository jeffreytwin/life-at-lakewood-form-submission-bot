import { describe, it, expect } from "vitest";
import { scoreAgent, selectBestAgent } from "@/lib/scoring/engine";
import type { Agent } from "@/lib/supabase/types";
import type { ScoringContext } from "@/lib/scoring/types";

function makeAgent(id: string, overrides: Partial<Agent> = {}): Agent {
  return {
    id,
    salesforce_user_id: `sf-${id}`,
    name: `Agent ${id}`,
    phone: "+19415551234",
    email: "test@example.com",
    is_frontlines: false,
    is_active: true,
    close_rate_trailing_12m: 0.2,
    close_rate_all_time: 0.15,
    location_specialties: ["Lakewood Ranch"],
    monthly_lead_goal_min: 30,
    monthly_lead_goal_max: 40,
    optimal_load_factor: 1.0,
    daily_lead_max: 5,
    unavailability_windows: null,
    price_ranges: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

const defaultContext: ScoringContext = {
  lead: {
    id: "lead-1",
    salesforce_record_id: null,
    location_id: null,
    form_name: "Floor Plan",
    first_name: "John",
    last_name: "Doe",
    email: "john@example.com",
    phone: "941-555-0001",
    floor_plan: null,
    village: "Lakewood Ranch",
    price: "$500,000",
    home_type: null,
    property_address: null,
    url: null,
    builder: null,
    timeline: null,
    message: null,
    owner_name: null,
    raw_payload: null,
    routing_status: "pending",
    final_agent_id: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  locationName: "Life At Lakewood",
  currentMonthLeadCounts: new Map(),
  dailyLeadCounts: new Map(),
  currentTime: new Date("2026-03-03T14:00:00"),
};

describe("scoreAgent", () => {
  it("produces a score with all factor breakdowns", () => {
    const agent = makeAgent("a1");
    const result = scoreAgent(agent, defaultContext);

    expect(result.agentId).toBe("a1");
    expect(result.totalScore).toBeGreaterThan(0);
    expect(result.factors).toHaveProperty("close_rate");
    expect(result.factors).toHaveProperty("lead_load");
  });
});

describe("selectBestAgent", () => {
  it("selects agent with highest score", () => {
    const agents = [
      makeAgent("low", { close_rate_trailing_12m: 0.05, close_rate_all_time: 0.05 }),
      makeAgent("high", { close_rate_trailing_12m: 0.3, close_rate_all_time: 0.25 }),
    ];

    const result = selectBestAgent(agents, defaultContext);
    expect(result?.agentId).toBe("high");
  });

  it("excludes specified agents", () => {
    const agents = [
      makeAgent("a1", { close_rate_trailing_12m: 0.3, close_rate_all_time: 0.25 }),
      makeAgent("a2", { close_rate_trailing_12m: 0.1, close_rate_all_time: 0.1 }),
    ];

    const result = selectBestAgent(agents, defaultContext, ["a1"]);
    expect(result?.agentId).toBe("a2");
  });

  it("returns null when all agents excluded", () => {
    const agents = [makeAgent("a1")];
    const result = selectBestAgent(agents, defaultContext, ["a1"]);
    expect(result).toBeNull();
  });

  it("returns null for empty agent list", () => {
    const result = selectBestAgent([], defaultContext);
    expect(result).toBeNull();
  });

  it("excludes agents that don't match location (hard filter)", () => {
    const agents = [
      makeAgent("wp", { location_specialties: ["Wellen Park"] }),
      makeAgent("lwr", { location_specialties: ["Lakewood Ranch"] }),
    ];

    const result = selectBestAgent(agents, defaultContext);
    expect(result?.agentId).toBe("lwr");
  });

  it("returns null when no agents match location", () => {
    const agents = [
      makeAgent("wp", { location_specialties: ["Wellen Park"] }),
    ];

    const result = selectBestAgent(agents, defaultContext);
    expect(result).toBeNull();
  });

  it("excludes agents that don't match price range (hard filter)", () => {
    const agents = [
      makeAgent("cheap", { price_ranges: ["under_250k"] }),
      makeAgent("mid", { price_ranges: ["500k_to_750k"] }),
    ];

    // Lead price is $500,000 which maps to "500k_to_750k"
    const result = selectBestAgent(agents, defaultContext);
    expect(result?.agentId).toBe("mid");
  });

  it("allows agents with null price_ranges (accepts all)", () => {
    const agents = [
      makeAgent("any", { price_ranges: null }),
    ];

    const result = selectBestAgent(agents, defaultContext);
    expect(result?.agentId).toBe("any");
  });

  it("excludes unavailable agents (hard filter)", () => {
    // Tuesday at 14:00
    const agents = [
      makeAgent("unavail", {
        unavailability_windows: [{ day: 2, start: "08:00", end: "17:00" }],
      }),
      makeAgent("avail", { unavailability_windows: null }),
    ];

    const result = selectBestAgent(agents, defaultContext);
    expect(result?.agentId).toBe("avail");
  });

  it("returns null when all agents are unavailable", () => {
    const agents = [
      makeAgent("a1", {
        unavailability_windows: [{ day: 2, start: "08:00", end: "17:00" }],
      }),
    ];

    const result = selectBestAgent(agents, defaultContext);
    expect(result).toBeNull();
  });

  it("prefers agents under their daily cap", () => {
    const agents = [
      makeAgent("capped", { daily_lead_max: 3, close_rate_trailing_12m: 0.3, close_rate_all_time: 0.25 }),
      makeAgent("available", { daily_lead_max: 3, close_rate_trailing_12m: 0.1, close_rate_all_time: 0.1 }),
    ];

    const ctx: ScoringContext = {
      ...defaultContext,
      dailyLeadCounts: new Map([["capped", 3]]), // at cap
    };

    // "capped" has better close rate but is at cap, so "available" should win
    const result = selectBestAgent(agents, ctx);
    expect(result?.agentId).toBe("available");
  });

  it("allows overflow when all agents are at daily cap", () => {
    const agents = [
      makeAgent("best", { daily_lead_max: 2, close_rate_trailing_12m: 0.3, close_rate_all_time: 0.25 }),
      makeAgent("other", { daily_lead_max: 2, close_rate_trailing_12m: 0.1, close_rate_all_time: 0.1 }),
    ];

    const ctx: ScoringContext = {
      ...defaultContext,
      dailyLeadCounts: new Map([["best", 2], ["other", 2]]), // both at cap
    };

    // Both at cap, so overflow to highest scored
    const result = selectBestAgent(agents, ctx);
    expect(result?.agentId).toBe("best");
  });
});
