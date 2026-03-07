import { describe, it, expect } from "vitest";
import { agentMatchesLocation } from "@/lib/scoring/factors/location-match";
import { agentMatchesPriceRange, parsePriceToMidpoint, priceToBucket } from "@/lib/scoring/factors/price-range";
import { scoreCloseRate } from "@/lib/scoring/factors/close-rate";
import { scoreLeadLoad } from "@/lib/scoring/factors/lead-load";
import { agentIsAvailable } from "@/lib/scoring/factors/availability";
import type { Agent, Lead } from "@/lib/supabase/types";
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
    daily_lead_max: 5,
    unavailability_windows: null,
    price_ranges: null,
    photo_url: null,
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
    dailyLeadCounts: new Map(),
    currentTime: new Date("2026-03-03T14:00:00"),
    ...overrides,
  };
}

describe("agentMatchesLocation (hard filter)", () => {
  it("returns true for matching location specialty", () => {
    const agent = makeAgent({ location_specialties: ["Life At Lakewood"] });
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
    const agent = makeAgent({ price_ranges: ["500k_to_750k"] });
    const ctx = makeContext({ lead: makeLead({ price: "$550,000" }) });
    expect(agentMatchesPriceRange(agent, ctx)).toBe(true);
  });

  it("returns false when agent's price range doesn't match", () => {
    const agent = makeAgent({ price_ranges: ["under_250k"] });
    const ctx = makeContext({ lead: makeLead({ price: "$750,000" }) });
    expect(agentMatchesPriceRange(agent, ctx)).toBe(false);
  });

  it("returns true when lead has no price", () => {
    const agent = makeAgent({ price_ranges: ["under_250k"] });
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
  it("maps under $250k correctly", () => {
    expect(priceToBucket(150_000)).toBe("under_250k");
    expect(priceToBucket(249_999)).toBe("under_250k");
  });

  it("maps $250k-$500k correctly", () => {
    expect(priceToBucket(250_000)).toBe("250k_to_500k");
    expect(priceToBucket(350_000)).toBe("250k_to_500k");
    expect(priceToBucket(499_999)).toBe("250k_to_500k");
  });

  it("maps $500k-$750k correctly", () => {
    expect(priceToBucket(500_000)).toBe("500k_to_750k");
    expect(priceToBucket(600_000)).toBe("500k_to_750k");
    expect(priceToBucket(749_999)).toBe("500k_to_750k");
  });

  it("maps $750k-$1M correctly", () => {
    expect(priceToBucket(750_000)).toBe("750k_to_1m");
    expect(priceToBucket(999_999)).toBe("750k_to_1m");
  });

  it("maps $1M-$1.5M correctly", () => {
    expect(priceToBucket(1_000_000)).toBe("1m_to_1_5m");
    expect(priceToBucket(1_250_000)).toBe("1m_to_1_5m");
    expect(priceToBucket(1_499_999)).toBe("1m_to_1_5m");
  });

  it("maps $1.5M+ correctly", () => {
    expect(priceToBucket(1_500_000)).toBe("1_5m_plus");
    expect(priceToBucket(2_000_000)).toBe("1_5m_plus");
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

  it("calculates normalized rate correctly", () => {
    const agent = makeAgent({
      close_rate_trailing_12m: 0.25,
      close_rate_all_time: 0.20,
    });
    const score = scoreCloseRate(agent);
    // 0.25 / 0.30 (MAX_EXPECTED_CLOSE_RATE) ≈ 0.833
    expect(score).toBeCloseTo(0.833, 2);
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

  it("returns 0.5 exactly at min goal", () => {
    const agent = makeAgent({ monthly_lead_goal_min: 30, monthly_lead_goal_max: 40 });
    const counts = new Map([["agent-1", 30]]);
    const ctx = makeContext({ currentMonthLeadCounts: counts });
    expect(scoreLeadLoad(agent, ctx)).toBeCloseTo(0.5, 5);
  });

  it("returns 0.0 at max goal", () => {
    const agent = makeAgent({ monthly_lead_goal_min: 30, monthly_lead_goal_max: 40 });
    const counts = new Map([["agent-1", 40]]);
    const ctx = makeContext({ currentMonthLeadCounts: counts });
    expect(scoreLeadLoad(agent, ctx)).toBe(0.0);
  });

  it("differentiates from the very first lead (no plateau)", () => {
    const agent = makeAgent({ monthly_lead_goal_min: 30, monthly_lead_goal_max: 40 });
    const countsZero = new Map<string, number>();
    const countsOne = new Map([["agent-1", 1]]);
    const ctx0 = makeContext({ currentMonthLeadCounts: countsZero });
    const ctx1 = makeContext({ currentMonthLeadCounts: countsOne });
    expect(scoreLeadLoad(agent, ctx0)).toBeGreaterThan(scoreLeadLoad(agent, ctx1));
  });

  it("agents below min always score above 0.5", () => {
    const agent = makeAgent({ monthly_lead_goal_min: 30, monthly_lead_goal_max: 40 });
    const counts = new Map([["agent-1", 15]]);
    const ctx = makeContext({ currentMonthLeadCounts: counts });
    expect(scoreLeadLoad(agent, ctx)).toBeGreaterThan(0.5);
  });

  it("agents above min but below max score between 0 and 0.5", () => {
    const agent = makeAgent({ monthly_lead_goal_min: 30, monthly_lead_goal_max: 40 });
    const counts = new Map([["agent-1", 35]]);
    const ctx = makeContext({ currentMonthLeadCounts: counts });
    const score = scoreLeadLoad(agent, ctx);
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(0.5);
  });
});

describe("agentIsAvailable (hard filter)", () => {
  it("returns true when no unavailability windows set", () => {
    const agent = makeAgent({ unavailability_windows: null });
    const ctx = makeContext();
    expect(agentIsAvailable(agent, ctx)).toBe(true);
  });

  it("returns true when outside unavailability window", () => {
    const tuesday = new Date("2026-03-03T14:00:00");
    const agent = makeAgent({
      unavailability_windows: [{ day: 2, start: "18:00", end: "23:00" }],
    });
    const ctx = makeContext({ currentTime: tuesday });
    expect(agentIsAvailable(agent, ctx)).toBe(true);
  });

  it("returns false when inside unavailability window", () => {
    const tuesday = new Date("2026-03-03T14:00:00");
    const agent = makeAgent({
      unavailability_windows: [{ day: 2, start: "08:00", end: "19:00" }],
    });
    const ctx = makeContext({ currentTime: tuesday });
    expect(agentIsAvailable(agent, ctx)).toBe(false);
  });

  it("returns true on a different day than the unavailability window", () => {
    const wednesday = new Date("2026-03-04T14:00:00");
    const agent = makeAgent({
      unavailability_windows: [{ day: 2, start: "08:00", end: "19:00" }],
    });
    const ctx = makeContext({ currentTime: wednesday });
    expect(agentIsAvailable(agent, ctx)).toBe(true);
  });
});
