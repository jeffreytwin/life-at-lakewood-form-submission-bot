import type { Lead } from "@/lib/supabase/types";

export interface ScoringContext {
  lead: Lead;
  locationName: string;
  currentMonthLeadCounts: Map<string, number>; // agentId -> count
  currentTime: Date;
}

export interface AgentScore {
  agentId: string;
  agentName: string;
  totalScore: number;
  factors: {
    close_rate: number;
    lead_load: number;
  };
}

export type ScoringFactor = (agent: import("@/lib/supabase/types").Agent, context: ScoringContext) => number;
