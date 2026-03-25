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
      .select("*, agents:agent_handoff_id(id, name, email), email_threads:thread_id(salesforce_owner_id, salesforce_owner_name, is_master_agent_owned, sender_name, sender_email, email_account_id), email_accounts:email_account_id(id, email_address, display_name)")
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

    // For sent drafts, fetch all inbound messages per thread for response time
    // We need the most recent inbound message *before* each draft was created
    const sentDrafts = (data ?? []).filter(
      (d: { status: string; thread_id: string | null }) => d.status === "sent" && d.thread_id
    );
    const sentThreadIds = [...new Set(sentDrafts.map((d: { thread_id: string }) => d.thread_id))];
    let inboundMessagesByThread = new Map<string, string[]>();
    if (sentThreadIds.length > 0) {
      const { data: inboundMessages } = await supabase
        .from("email_messages")
        .select("thread_id, received_at")
        .in("thread_id", sentThreadIds)
        .eq("direction", "inbound")
        .order("received_at", { ascending: true });
      if (inboundMessages) {
        for (const msg of inboundMessages) {
          if (msg.received_at) {
            const list = inboundMessagesByThread.get(msg.thread_id) ?? [];
            list.push(msg.received_at);
            inboundMessagesByThread.set(msg.thread_id, list);
          }
        }
      }
    }

    const enriched = (data ?? []).map((d: {
      id: string;
      status: string;
      thread_id: string | null;
      sent_at: string | null;
      body_text: string | null;
      sent_body_text: string | null;
      email_threads: {
        salesforce_owner_id: string | null;
        salesforce_owner_name: string | null;
        is_master_agent_owned: boolean | null;
        sender_name: string | null;
        sender_email: string | null;
        email_account_id: string | null;
      } | null;
      email_accounts: {
        id: string;
        email_address: string;
        display_name: string | null;
      } | null;
    }) => {
      const thread = d.email_threads;
      const ownerId = thread?.salesforce_owner_id ?? null;
      // Prefer agent name from our DB, fall back to Salesforce owner name
      const resolvedOwnerName = ownerId && ownerAgentMap.has(ownerId)
        ? ownerAgentMap.get(ownerId)!
        : thread?.salesforce_owner_name ?? null;

      // Calculate response time for sent drafts
      // Use the most recent inbound message received before this draft was created
      let response_time_ms: number | null = null;
      if (d.status === "sent" && d.sent_at && d.thread_id) {
        const inboundTimes = inboundMessagesByThread.get(d.thread_id);
        if (inboundTimes) {
          const draftCreatedAt = new Date((d as unknown as { created_at: string }).created_at).getTime();
          // Find the latest inbound message received before this draft was created
          let latestBefore: string | null = null;
          for (const t of inboundTimes) {
            if (new Date(t).getTime() <= draftCreatedAt) {
              latestBefore = t;
            }
          }
          if (latestBefore) {
            response_time_ms = new Date(d.sent_at).getTime() - new Date(latestBefore).getTime();
          }
        }
      }

      return {
        ...d,
        added_to_training: trainingDraftIds.has(d.id),
        salesforce_owner_name: resolvedOwnerName,
        is_master_agent_owned: thread?.is_master_agent_owned ?? null,
        sender_name: thread?.sender_name ?? null,
        sender_email: thread?.sender_email ?? null,
        account_email: d.email_accounts?.email_address ?? null,
        account_display_name: d.email_accounts?.display_name ?? null,
        preview_text: d.status === "sent"
          ? (d.sent_body_text ?? d.body_text ?? "")?.slice(0, 120)
          : (d.body_text ?? "")?.slice(0, 120),
        response_time_ms,
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
