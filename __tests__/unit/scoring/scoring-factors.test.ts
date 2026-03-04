import { describe, it, expect } from "vitest";
import { agentMatchesLocation } from "@/lib/scoring/factors/location-match";
import { agentMatchesPriceRange, parsePriceToMidpoint, priceToBucket } from "@/lib/scoring/factors/price-range";
import { scoreCloseRate } from "@/lib/scoring/factors/close-rate";
import { scoreLeadLoad } from "@/lib/scoring/factors/lead-load";
import { scoreAvailability } from "@/lib/scoring/factors/availability";
import type { Agent, Lead } from "@/lib/supabase/types";
import { DEFAULT_SCORING_PRIORITY } from "@/lib/supabase/types";
import type { ScoringContext } from "@/lib/scoring/types";

function makeAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: "agent-1",
    salesforce_user_id: "sf-1",
    name: "Test Agent",
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
    availability_windows: null,
    scoring_priority: [...DEFAULT_SCORING_PRIORITY],
    price_ranges: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

function makeLead(overrides: Partial<Lead> = {}): Lead {
  return {
    id: "lead-1",
    salesforce_record_id: "sf-lead-1",
    location_id: "loc-1",
    form_name: "Floor Plan",
    first_name: "John",
    last_name: "Doe",
    email: "john@example.com",
    phone: "941-555-0001",
    floor_plan: "The Palermo",
    village: "Lakewood Ranch",
    price: "$500,000 - $600,000",
    home_type: "Single Family",
    property_address: null,
    url: "https://example.com",
    builder: null,
    timeline: null,
    message: null,
    owner_name: null,
    raw_payload: null,
    routing_status: "pending",
    final_agent_id: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

function makeContext(overrides: Partial<ScoringContext> = {}): ScoringContext {
  return {
    lead: makeLead(),
    locationName: "Life At Lakewood",
    currentMonthLeadCounts: new Map(),
    currentTime: new Date("2026-03-03T14:00:00"),
    ...overrides,
  };
}

describe("agentMatchesLocation (hard filter)", () => {
  it("returns true for matching location specialty", () => {
    const agent = makeAgent({ location_specialties: ["Lakewood Ranch"] });
    const ctx = makeContext({ locationName: "Life At Lakewood" });
    expect(agentMatchesLocation(agent, ctx)).toBe(true);
  });

  it("returns false for non-matching location", () => {
    const agent = makeAgent({ location_specialties: ["Wellen Park"] });
    const ctx = makeContext({ locationName: "Life At Lakewood" });
    expect(agentMatchesLocation(agent, ctx)).toBe(false);
  });

  it("returns true when no location info on lead", () => {
    const agent = makeAgent();
    const ctx = makeContext({
      locationName: "",
      lead: makeLead({ village: null }),
    });
    expect(agentMatchesLocation(agent, ctx)).toBe(true);
  });

  it("returns true for LWR agent on Parrish lead", () => {
    const agent = makeAgent({ location_specialties: ["Lakewood Ranch"] });
    const ctx = makeContext({
      locationName: "Life At Parrish",
      lead: makeLead({ village: "Parrish" }),
    });
    expect(agentMatchesLocation(agent, ctx)).toBe(true);
  });

  it("returns true for agents with no specialties", () => {
    const agent = makeAgent({ location_specialties: [] });
    const ctx = makeContext({ locationName: "Life At Lakewood" });
    expect(agentMatchesLocation(agent, ctx)).toBe(true);
  });
});

describe("agentMatchesPriceRange (hard filter)", () => {
  it("returns true when agent has no price ranges (accepts all)", () => {
    const agent = makeAgent({ price_ranges: null });
    const ctx = makeContext();
    expect(agentMatchesPriceRange(agent, ctx)).toBe(true);
  });

  it("returns true when agent's price range matches lead price", () => {
    const agent = makeAgent({ price_ranges: ["500k_to_1m"] });
    const ctx = makeContext({ lead: makeLead({ price: "$550,000" }) });
    expect(agentMatchesPriceRange(agent, ctx)).toBe(true);
  });

  it("returns false when agent's price range doesn't match", () => {
    const agent = makeAgent({ price_ranges: ["under_500k"] });
    const ctx = makeContext({ lead: makeLead({ price: "$750,000" }) });
    expect(agentMatchesPriceRange(agent, ctx)).toBe(false);
  });

  it("returns true when lead has no price", () => {
    const agent = makeAgent({ price_ranges: ["under_500k"] });
    const ctx = makeContext({ lead: makeLead({ price: null }) });
    expect(agentMatchesPriceRange(agent, ctx)).toBe(true);
  });

  it("returns true for empty price_ranges array", () => {
    const agent = makeAgent({ price_ranges: [] });
    const ctx = makeContext();
    expect(agentMatchesPriceRange(agent, ctx)).toBe(true);
  });
});

describe("parsePriceToMidpoint", () => {
  it("parses range format", () => {
    expect(parsePriceToMidpoint("$500,000 - $600,000")).toBe(550_000);
  });

  it("parses single value", () => {
    expect(parsePriceToMidpoint("$450,000")).toBe(450_000);
  });

  it("returns null for no numbers", () => {
    expect(parsePriceToMidpoint("Contact for price")).toBeNull();
  });
});

describe("priceToBucket", () => {
  it("maps under $500k correctly", () => {
    expect(priceToBucket(350_000)).toBe("under_500k");
    expect(priceToBucket(499_999)).toBe("under_500k");
  });

  it("maps $500k-$1M correctly", () => {
    expect(priceToBucket(500_000)).toBe("500k_to_1m");
    expect(priceToBucket(750_000)).toBe("500k_to_1m");
    expect(priceToBucket(1_000_000)).toBe("500k_to_1m");
  });

  it("maps $1M+ correctly", () => {
    expect(priceToBucket(1_000_001)).toBe("1m_plus");
    expect(priceToBucket(2_000_000)).toBe("1m_plus");
  });
});

describe("scoreCloseRate", () => {
  it("returns default 0.5 for agents with no data", () => {
    const agent = makeAgent({
      close_rate_trailing_12m: 0,
      close_rate_all_time: 0,
    });
    expect(scoreCloseRate(agent)).toBe(0.5);
  });

  it("calculates blended rate correctly", () => {
    const agent = makeAgent({
      close_rate_trailing_12m: 0.25,
      close_rate_all_time: 0.20,
    });
    const score = scoreCloseRate(agent);
    expect(score).toBeCloseTo(0.783, 2);
  });

  it("caps at 1.0 for very high close rates", () => {
    const agent = makeAgent({
      close_rate_trailing_12m: 0.5,
      close_rate_all_time: 0.4,
    });
    expect(scoreCloseRate(agent)).toBe(1.0);
  });
});

describe("scoreLeadLoad", () => {
  it("returns 1.0 when agent has no leads yet", () => {
    const agent = makeAgent({ monthly_lead_goal_min: 30, monthly_lead_goal_max: 40 });
    const ctx = makeContext({ currentMonthLeadCounts: new Map() });
    expect(scoreLeadLoad(agent, ctx)).toBe(1.0);
  });

  it("returns 1.0 at 50% of min goal", () => {
    const agent = makeAgent({ monthly_lead_goal_min: 30, monthly_lead_goal_max: 40 });
    const counts = new Map([["agent-1", 15]]);
    const ctx = makeContext({ currentMonthLeadCounts: counts });
    expect(scoreLeadLoad(agent, ctx)).toBe(1.0);
  });

  it("returns 0.0 at 120% of max goal", () => {
    const agent = makeAgent({ monthly_lead_goal_min: 30, monthly_lead_goal_max: 40 });
    const counts = new Map([["agent-1", 48]]);
    const ctx = makeContext({ currentMonthLeadCounts: counts });
    expect(scoreLeadLoad(agent, ctx)).toBe(0.0);
  });

  it("returns intermediate value in between", () => {
    const agent = makeAgent({ monthly_lead_goal_min: 30, monthly_lead_goal_max: 40 });
    const counts = new Map([["agent-1", 30]]);
    const ctx = makeContext({ currentMonthLeadCounts: counts });
    const score = scoreLeadLoad(agent, ctx);
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(1);
  });
});

describe("scoreAvailability", () => {
  it("returns 1.0 when no availability windows set", () => {
    const agent = makeAgent({ availability_windows: null });
    const ctx = makeContext();
    expect(scoreAvailability(agent, ctx)).toBe(1.0);
  });

  it("returns 1.0 when within availability window", () => {
    const tuesday = new Date("2026-03-03T14:00:00");
    const agent = makeAgent({
      availability_windows: [{ day: 2, start: "08:00", end: "19:00" }],
    });
    const ctx = makeContext({ currentTime: tuesday });
    expect(scoreAvailability(agent, ctx)).toBe(1.0);
  });

  it("returns 0.0 when outside availability window", () => {
    const tuesday = new Date("2026-03-03T21:00:00");
    const agent = makeAgent({
      availability_windows: [{ day: 2, start: "08:00", end: "19:00" }],
    });
    const ctx = makeContext({ currentTime: tuesday });
    expect(scoreAvailability(agent, ctx)).toBe(0.0);
  });
});
