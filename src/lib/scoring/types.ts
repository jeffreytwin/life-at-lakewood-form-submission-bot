import type { Lead } from "@/lib/supabase/types";

export interface ScoringContext {
  lead: Lead;
  locationName: string;
  currentMonthLeadCounts: Map<string, number>; // agentId -> count
  dailyLeadCounts: Map<string, number>; // agentId -> count today
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
  specialtyBonus: number; // 1.0 = generalist, 1.15 = specialist match
  monthlyCapMultiplier: number; // 1.0 = under max goal, 0.4 = at max, ramps to 0.1
}

export type ScoringFactor = (agent: import("@/lib/supabase/types").Agent, context: ScoringContext) => number;
