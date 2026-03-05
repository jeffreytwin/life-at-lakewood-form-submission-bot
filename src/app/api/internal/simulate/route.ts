import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase/client";
import { scoreAgents } from "@/lib/scoring/engine";
import { agentMatchesLocation } from "@/lib/scoring/factors/location-match";
import { agentMatchesPriceRange } from "@/lib/scoring/factors/price-range";
import { agentIsAvailable } from "@/lib/scoring/factors/availability";
import type { Agent, Lead } from "@/lib/supabase/types";
import type { ScoringContext } from "@/lib/scoring/types";

export const dynamic = "force-dynamic";

/**
 * POST /api/internal/simulate
 *
 * Runs the scoring engine in read-only mode. No leads, routing attempts,
 * or audit entries are created. Safe for production use.
 *
 * Body: { leads: LeadInput[] }
 * LeadInput: { location, village, price, form_name }
 */

interface LeadInput {
  location: string;
  village: string;
  price: string;
  form_name?: string;
}

interface SimulatedAssignment {
  leadIndex: number;
  lead: LeadInput;
  assignedAgent: string | null;
  assignedAgentId: string | null;
  scores: Array<{
    agentName: string;
    agentId: string;
    totalScore: number;
    factors: Record<string, number>;
    filtered: boolean;
    filterReason?: string;
  }>;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { leads } = body as { leads: LeadInput[] };

    if (!leads || !Array.isArray(leads) || leads.length === 0) {
      return NextResponse.json(
        { error: "Must provide an array of leads" },
        { status: 400 }
      );
    }

    if (leads.length > 500) {
      return NextResponse.json(
        { error: "Maximum 500 leads per simulation" },
        { status: 400 }
      );
    }

    // Fetch agents and current month lead counts (read-only)
    const [agentsResult, countsResult, locationsResult] = await Promise.all([
      supabase
        .from("agents")
        .select("*")
        .eq("is_active", true)
        .eq("is_frontlines", false),
      supabase
        .from("monthly_lead_counts")
        .select("agent_id, lead_count")
        .eq("year_month", new Date().toISOString().slice(0, 7)),
      supabase.from("locations").select("*").eq("is_active", true),
    ]);

    if (agentsResult.error) throw agentsResult.error;
    if (countsResult.error) throw countsResult.error;
    if (locationsResult.error) throw locationsResult.error;

    const agents: Agent[] = agentsResult.data;
    const locationsList = locationsResult.data;

    // Build mutable lead counts (simulates accumulation across the batch)
    const leadCounts = new Map<string, number>();
    for (const row of countsResult.data ?? []) {
      leadCounts.set(row.agent_id, row.lead_count);
    }

    const results: SimulatedAssignment[] = [];

    for (let i = 0; i < leads.length; i++) {
      const input = leads[i];

      // Resolve location name
      const matchedLocation = locationsList.find(
        (loc) =>
          loc.name.toLowerCase().includes(input.location.toLowerCase()) ||
          input.location.toLowerCase().includes(loc.slug.toLowerCase())
      );
      const locationName = matchedLocation?.name ?? input.location;

      // Build a fake lead object (never saved to DB)
      const fakeLead: Lead = {
        id: `sim-${i}`,
        salesforce_record_id: null,
        location_id: matchedLocation?.id ?? null,
        form_name: input.form_name ?? "Contact Us",
        first_name: "Sim",
        last_name: `Lead ${i + 1}`,
        email: null,
        phone: null,
        floor_plan: null,
        village: input.village || null,
        price: input.price || null,
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
      };

      const context: ScoringContext = {
        lead: fakeLead,
        locationName,
        currentMonthLeadCounts: leadCounts,
        currentTime: new Date(),
      };

      // Score all agents and show which ones are filtered
      const allAgentScores = agents.map((agent) => {
        const locMatch = agentMatchesLocation(agent, context);
        const priceMatch = agentMatchesPriceRange(agent, context);
        const available = agentIsAvailable(agent, context);

        if (!locMatch) {
          return {
            agentName: agent.name,
            agentId: agent.id,
            totalScore: 0,
            factors: {},
            filtered: true,
            filterReason: "Location mismatch",
          };
        }
        if (!priceMatch) {
          return {
            agentName: agent.name,
            agentId: agent.id,
            totalScore: 0,
            factors: {},
            filtered: true,
            filterReason: "Price range mismatch",
          };
        }
        if (!available) {
          return {
            agentName: agent.name,
            agentId: agent.id,
            totalScore: 0,
            factors: {},
            filtered: true,
            filterReason: "Currently unavailable",
          };
        }

        return { agentName: agent.name, agentId: agent.id, totalScore: 0, factors: {}, filtered: false };
      });

      // Score eligible agents
      const eligible = agents.filter(
        (a) =>
          agentMatchesLocation(a, context) &&
          agentMatchesPriceRange(a, context) &&
          agentIsAvailable(a, context)
      );
      const scored = scoreAgents(eligible, context);

      // Merge scored results
      for (const s of scored) {
        const entry = allAgentScores.find((a) => a.agentId === s.agentId);
        if (entry) {
          entry.totalScore = s.totalScore;
          entry.factors = s.factors;
        }
      }

      // Sort: eligible first (by score desc), then filtered
      allAgentScores.sort((a, b) => {
        if (a.filtered && !b.filtered) return 1;
        if (!a.filtered && b.filtered) return -1;
        return b.totalScore - a.totalScore;
      });

      const winner = scored[0] ?? null;

      results.push({
        leadIndex: i,
        lead: input,
        assignedAgent: winner?.agentName ?? null,
        assignedAgentId: winner?.agentId ?? null,
        scores: allAgentScores,
      });

      // Simulate lead count increment for batch mode
      if (winner) {
        const current = leadCounts.get(winner.agentId) ?? 0;
        leadCounts.set(winner.agentId, current + 1);
      }
    }

    // Build summary
    const summary: Record<string, number> = {};
    let unassigned = 0;
    for (const r of results) {
      if (r.assignedAgent) {
        summary[r.assignedAgent] = (summary[r.assignedAgent] ?? 0) + 1;
      } else {
        unassigned++;
      }
    }

    return NextResponse.json({ results, summary, unassigned });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
