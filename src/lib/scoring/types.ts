import type { Agent, Lead, ScoringWeights } from "@/lib/supabase/types";

export interface ScoringContext {
  lead: Lead;
  locationName: string;
  currentMonthLeadCounts: Map<string, number>; // agentId -> count
  weights: ScoringWeights;
  currentTime: Date;
}

export interface AgentScore {
  agentId: string;
  agentName: string;
  totalScore: number;
  factors: {
    location_match: number;
    close_rate: number;
    lead_load: number;
    lead_value: number;
    availability: number;
    optimal_load: number;
  };
}

export type ScoringFactor = (agent: Agent, context: ScoringContext) => number;
