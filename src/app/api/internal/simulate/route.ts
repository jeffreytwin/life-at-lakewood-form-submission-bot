import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase/client";
import { scoreAgents } from "@/lib/scoring/engine";
import { agentMatchesLocation } from "@/lib/scoring/factors/location-match";
import { agentMatchesPriceRange } from "@/lib/scoring/factors/price-range";
import { agentIsAvailable } from "@/lib/scoring/factors/availability";
import type { Agent, Lead, ScoringFactorKey } from "@/lib/supabase/types";
import { DEFAULT_GLOBAL_WEIGHTS } from "@/lib/supabase/types";
import type { ScoringContext } from "@/lib/scoring/types";

export const dynamic = "force-dynamic";

/**
 * POST /api/internal/simulate
 *
 * Modes:
 *   - single: { leads: [LeadInput] }
 *   - bulk:   { leads: LeadInput[] }
 *   - 30day:  { mode: "30day", leadsPerDay: number, locations: string[], prices: string[] }
 *
 * 30-day mode generates leads across 30 days with random Eastern time
 * timestamps to test unavailability windows. Daily lead caps reset each day.
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
  dailyCapped: boolean; // true if winner was assigned via overflow (all at cap)
  scores: Array<{
    agentName: string;
    agentId: string;
    totalScore: number;
    factors: Record<string, number>;
    filtered: boolean;
    filterReason?: string;
  }>;
}

interface LeadDecision {
  index: number;
  time: string; // formatted Eastern time e.g. "2:35 PM"
  location: string;
  price: string;
  assignedAgent: string | null;
  assignedAgentId: string | null;
  totalScore: number | null;
  specialtyBonus: number | null;
  monthlyCapMult: number | null;
  dailyCapped: boolean; // true if assigned via overflow (all at daily cap)
  factors: Record<string, number> | null;
}

interface DaySummary {
  day: number; // 1-30
  date: string; // "2026-03-01"
  dayOfWeek: string; // "Monday"
  leadsAssigned: number;
  leadsUnassigned: number;
  agentBreakdown: Record<string, number>;
  overflowCount: number; // leads assigned despite daily cap
  leadDecisions: LeadDecision[];
}

/** Generate a random Eastern time during business-ish hours (7am-8pm) */
function randomEasternTime(dayOffset: number, baseDate: Date): Date {
  const d = new Date(baseDate);
  d.setDate(d.getDate() + dayOffset);

  // Random hour 7-20 (7am to 8pm ET), random minute
  const hour = 7 + Math.floor(Math.random() * 13);
  const minute = Math.floor(Math.random() * 60);

  // Build an Eastern time string and parse it
  // Eastern offset: UTC-5 (EST) or UTC-4 (EDT)
  // For simulation purposes, use America/New_York via formatting
  const year = d.getFullYear();
  const month = d.getMonth(); // 0-indexed
  const day = d.getDate();

  // Create a date in Eastern time by computing UTC equivalent
  // Use the Intl API to figure out the current ET offset for this date
  const probe = new Date(Date.UTC(year, month, day, 12, 0, 0));
  const etString = probe.toLocaleString("en-US", { timeZone: "America/New_York" });
  const etDate = new Date(etString);
  const utcMs = probe.getTime();
  const etMs = etDate.getTime();
  const offsetMs = utcMs - etMs; // positive means ET is behind UTC

  // Build the target time in ET, convert to UTC
  const targetET = new Date(year, month, day, hour, minute, 0, 0);
  const targetUTC = new Date(targetET.getTime() + offsetMs);

  return targetUTC;
}

/** Get day-of-week name from a Date interpreted in Eastern time */
function getEasternDayOfWeek(utcDate: Date): { dayIndex: number; dayName: string } {
  const etString = utcDate.toLocaleString("en-US", {
    timeZone: "America/New_York",
    weekday: "long",
  });
  const dayIndex = new Date(
    utcDate.toLocaleString("en-US", { timeZone: "America/New_York" })
  ).getDay();
  return { dayIndex, dayName: etString };
}

/** Format a UTC date as Eastern time string */
function formatEasternTime(utcDate: Date): string {
  return utcDate.toLocaleString("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function agentUnderDailyCap(agent: Agent, dailyCounts: Map<string, number>): boolean {
  if (agent.daily_lead_max <= 0) return true;
  const count = dailyCounts.get(agent.id) ?? 0;
  return count < agent.daily_lead_max;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Fetch shared data (no monthly/daily counts — simulations start from zero)
    const [agentsResult, locationsResult, weightsResult] =
      await Promise.all([
        supabase
          .from("agents")
          .select("*")
          .eq("is_active", true)
          .eq("is_frontlines", false),
        supabase.from("locations").select("*").eq("is_active", true),
        supabase
          .from("scoring_weights")
          .select("close_rate, lead_load")
          .limit(1)
          .single(),
      ]);

    if (agentsResult.error) throw agentsResult.error;
    if (locationsResult.error) throw locationsResult.error;

    const agents: Agent[] = agentsResult.data;
    const locationsList = locationsResult.data;

    let weights: Record<ScoringFactorKey, number> = DEFAULT_GLOBAL_WEIGHTS;
    if (weightsResult.data) {
      weights = {
        close_rate: weightsResult.data.close_rate,
        lead_load: weightsResult.data.lead_load,
      };
    }

    // --- 30-DAY MODE ---
    if (body.mode === "30day") {
      const leadsPerDay = Math.min(Math.max(body.leadsPerDay ?? 5, 1), 50);
      const selectedLocations: string[] = body.locations?.length
        ? body.locations
        : locationsList.map((l) => l.name);
      const selectedPrices: string[] = body.prices?.length
        ? body.prices
        : [
            "$150,000 - $250,000",
            "$250,000 - $500,000",
            "$500,000 - $750,000",
            "$750,000 - $1,000,000",
            "$1,000,000 - $1,500,000",
            "$1,500,000+",
          ];

      const baseDate = new Date();
      // Start from zero — simulations should reflect scoring logic,
      // not cumulative production history.
      const monthlyLeadCounts = new Map<string, number>();

      const days: DaySummary[] = [];

      for (let day = 0; day < 30; day++) {
        // Reset daily counts each day
        const dailyCounts = new Map<string, number>();
        let dayAssigned = 0;
        let dayUnassigned = 0;
        let dayOverflow = 0;
        const dayAgents: Record<string, number> = {};
        const leadDecisions: LeadDecision[] = [];

        for (let i = 0; i < leadsPerDay; i++) {
          const simTime = randomEasternTime(day, baseDate);
          const loc = selectedLocations[Math.floor(Math.random() * selectedLocations.length)];
          const price = selectedPrices[Math.floor(Math.random() * selectedPrices.length)];

          const matchedLocation = locationsList.find(
            (l) => l.name.toLowerCase() === loc.toLowerCase()
          ) ?? locationsList.find(
            (l) => l.slug.toLowerCase() === loc.toLowerCase()
          );
          const locationName = matchedLocation?.name ?? loc;

          const fakeLead: Lead = {
            id: `sim-d${day}-${i}`,
            salesforce_record_id: null,
            location_id: matchedLocation?.id ?? null,
            form_name: "Contact Us",
            first_name: "Sim",
            last_name: `Lead`,
            email: null,
            phone: null,
            floor_plan: null,
            village: null,
            price,
            home_type: null,
            property_address: null,
            url: null,
            builder: null,
            timeline: null,
            message: null,
            owner_name: null,
            salesforce_owner_id: null,
            raw_payload: null,
            routing_status: "pending",
            final_agent_id: null,
            created_at: simTime.toISOString(),
            updated_at: simTime.toISOString(),
          };

          const context: ScoringContext = {
            lead: fakeLead,
            locationName,
            currentMonthLeadCounts: monthlyLeadCounts,
            dailyLeadCounts: dailyCounts,
            currentTime: simTime,
          };

          // Hard filters
          const eligible = agents.filter(
            (a) =>
              agentMatchesLocation(a, context) &&
              agentMatchesPriceRange(a, context) &&
              agentIsAvailable(a, context)
          );

          if (eligible.length === 0) {
            dayUnassigned++;
            leadDecisions.push({
              index: i,
              time: formatEasternTime(simTime),
              location: locationName,
              price,
              assignedAgent: null,
              assignedAgentId: null,
              totalScore: null,
              specialtyBonus: null,
              monthlyCapMult: null,
              dailyCapped: false,
              factors: null,
            });
            continue;
          }

          // Daily cap: hard filter with overflow
          const underCap = eligible.filter((a) => agentUnderDailyCap(a, dailyCounts));
          const pool = underCap.length > 0 ? underCap : eligible;
          const isOverflow = underCap.length === 0;

          const scored = scoreAgents(pool, context, weights);
          const winner = scored[0];

          if (winner) {
            dayAssigned++;
            if (isOverflow) dayOverflow++;
            dayAgents[winner.agentName] = (dayAgents[winner.agentName] ?? 0) + 1;

            // Increment counts
            const mc = monthlyLeadCounts.get(winner.agentId) ?? 0;
            monthlyLeadCounts.set(winner.agentId, mc + 1);
            const dc = dailyCounts.get(winner.agentId) ?? 0;
            dailyCounts.set(winner.agentId, dc + 1);
          } else {
            dayUnassigned++;
          }

          leadDecisions.push({
            index: i,
            time: formatEasternTime(simTime),
            location: locationName,
            price,
            assignedAgent: winner?.agentName ?? null,
            assignedAgentId: winner?.agentId ?? null,
            totalScore: winner?.totalScore ?? null,
            specialtyBonus: winner?.specialtyBonus ?? null,
            monthlyCapMult: winner?.monthlyCapMultiplier ?? null,
            dailyCapped: isOverflow && winner !== null,
            factors: winner?.factors ?? null,
          });
        }

        // Get day info in Eastern time
        const dayDate = new Date(baseDate);
        dayDate.setDate(dayDate.getDate() + day);
        const etDateStr = dayDate.toLocaleDateString("en-US", {
          timeZone: "America/New_York",
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        });
        const etDayOfWeek = dayDate.toLocaleDateString("en-US", {
          timeZone: "America/New_York",
          weekday: "long",
        });

        // Sort lead decisions by time for display
        leadDecisions.sort((a, b) => {
          const timeA = new Date(`1/1/2000 ${a.time}`).getTime();
          const timeB = new Date(`1/1/2000 ${b.time}`).getTime();
          return timeA - timeB;
        });

        days.push({
          day: day + 1,
          date: etDateStr,
          dayOfWeek: etDayOfWeek,
          leadsAssigned: dayAssigned,
          leadsUnassigned: dayUnassigned,
          agentBreakdown: dayAgents,
          overflowCount: dayOverflow,
          leadDecisions,
        });
      }

      // Build overall summary
      const overallSummary: Record<string, number> = {};
      let totalAssigned = 0;
      let totalUnassigned = 0;
      let totalOverflow = 0;
      for (const d of days) {
        totalAssigned += d.leadsAssigned;
        totalUnassigned += d.leadsUnassigned;
        totalOverflow += d.overflowCount;
        for (const [name, count] of Object.entries(d.agentBreakdown)) {
          overallSummary[name] = (overallSummary[name] ?? 0) + count;
        }
      }

      return NextResponse.json({
        mode: "30day",
        days,
        summary: overallSummary,
        totalAssigned,
        totalUnassigned,
        totalOverflow,
        totalLeads: 30 * leadsPerDay,
      });
    }

    // --- SINGLE / BULK MODE ---
    const { leads, simulateAt } = body as { leads: LeadInput[]; simulateAt?: string };

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

    // Start from zero — simulations should reflect scoring logic,
    // not cumulative production history.
    const leadCounts = new Map<string, number>();
    const dailyCounts = new Map<string, number>();

    const results: SimulatedAssignment[] = [];

    for (let i = 0; i < leads.length; i++) {
      const input = leads[i];

      const matchedLocation = locationsList.find(
        (loc) => loc.name.toLowerCase() === input.location.toLowerCase()
      ) ?? locationsList.find(
        (loc) => loc.slug.toLowerCase() === input.location.toLowerCase()
      );
      const locationName = matchedLocation?.name ?? input.location;

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
        salesforce_owner_id: null,
        raw_payload: null,
        routing_status: "pending",
        final_agent_id: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      // If simulateAt is provided (datetime-local string in ET), convert to UTC
      let simTime = new Date();
      if (simulateAt) {
        // datetime-local gives "YYYY-MM-DDTHH:MM" — interpret as Eastern
        const probe = new Date(simulateAt + ":00");
        const etString = probe.toLocaleString("en-US", { timeZone: "America/New_York" });
        const etDate = new Date(etString);
        const offsetMs = probe.getTime() - etDate.getTime();
        simTime = new Date(probe.getTime() + offsetMs);
      }

      const context: ScoringContext = {
        lead: fakeLead,
        locationName,
        currentMonthLeadCounts: leadCounts,
        dailyLeadCounts: dailyCounts,
        currentTime: simTime,
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

      // Hard filters
      const eligible = agents.filter(
        (a) =>
          agentMatchesLocation(a, context) &&
          agentMatchesPriceRange(a, context) &&
          agentIsAvailable(a, context)
      );

      // Daily cap with overflow
      const underCap = eligible.filter((a) => agentUnderDailyCap(a, dailyCounts));
      const pool = underCap.length > 0 ? underCap : eligible;
      const isOverflow = underCap.length === 0 && eligible.length > 0;

      const scored = scoreAgents(pool, context, weights);

      for (const s of scored) {
        const entry = allAgentScores.find((a) => a.agentId === s.agentId);
        if (entry) {
          entry.totalScore = s.totalScore;
          entry.factors = s.factors;
        }
      }

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
        dailyCapped: isOverflow && winner !== null,
        scores: allAgentScores,
      });

      if (winner) {
        const currentMonthly = leadCounts.get(winner.agentId) ?? 0;
        leadCounts.set(winner.agentId, currentMonthly + 1);
        const currentDaily = dailyCounts.get(winner.agentId) ?? 0;
        dailyCounts.set(winner.agentId, currentDaily + 1);
      }
    }

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
