import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase/client";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status");
    const isSimulation = searchParams.get("is_simulation");
    const limit = parseInt(searchParams.get("limit") ?? "50", 10);

    let query = supabase
      .from("email_drafts")
      .select("*, agents:agent_handoff_id(id, name, email), email_threads:thread_id(salesforce_owner_id, salesforce_owner_name, is_master_agent_owned)")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (status) {
      // "drafts" filter shows both drafted and approved statuses
      if (status === "drafted") {
        query = query.in("status", ["drafted", "approved"]);
      } else {
        query = query.eq("status", status);
      }
    }
    if (isSimulation !== null) {
      query = query.eq("is_simulation", isSimulation === "true");
    }

    const { data, error } = await query;
    if (error) throw error;

    // For sent drafts, check which ones have been added to training
    const sentDrafts = (data ?? []).filter((d: { status: string }) => d.status === "sent");
    let trainingDraftIds = new Set<string>();
    if (sentDrafts.length > 0) {
      const contextPatterns = sentDrafts.map(
        (d: { id: string }) => `Added from sent draft ${d.id}`
      );
      const { data: trainingMatches } = await supabase
        .from("training_examples")
        .select("context_notes")
        .in("context_notes", contextPatterns);

      if (trainingMatches) {
        for (const t of trainingMatches) {
          const match = t.context_notes?.match(/Added from sent draft (.+)/);
          if (match) trainingDraftIds.add(match[1]);
        }
      }
    }

    // Resolve Salesforce owner IDs to agent names from our agents table
    const ownerIds = [
      ...new Set(
        (data ?? [])
          .map((d: { email_threads: { salesforce_owner_id: string | null } | null }) =>
            d.email_threads?.salesforce_owner_id
          )
          .filter(Boolean) as string[]
      ),
    ];
    let ownerAgentMap = new Map<string, string>();
    if (ownerIds.length > 0) {
      const { data: ownerAgents } = await supabase
        .from("agents")
        .select("salesforce_user_id, name")
        .in("salesforce_user_id", ownerIds);
      if (ownerAgents) {
        for (const a of ownerAgents) {
          if (a.salesforce_user_id) ownerAgentMap.set(a.salesforce_user_id, a.name);
        }
      }
    }

    const enriched = (data ?? []).map((d: {
      id: string;
      status: string;
      email_threads: {
        salesforce_owner_id: string | null;
        salesforce_owner_name: string | null;
        is_master_agent_owned: boolean | null;
      } | null;
    }) => {
      const thread = d.email_threads;
      const ownerId = thread?.salesforce_owner_id ?? null;
      // Prefer agent name from our DB, fall back to Salesforce owner name
      const resolvedOwnerName = ownerId && ownerAgentMap.has(ownerId)
        ? ownerAgentMap.get(ownerId)!
        : thread?.salesforce_owner_name ?? null;

      return {
        ...d,
        added_to_training: trainingDraftIds.has(d.id),
        salesforce_owner_name: resolvedOwnerName,
        is_master_agent_owned: thread?.is_master_agent_owned ?? null,
      };
    });

    return NextResponse.json(enriched);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
