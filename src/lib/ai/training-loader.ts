import { supabase } from "@/lib/supabase/client";
import type { TrainingExample, TrainingCategory } from "@/lib/supabase/types";

export interface DraftFeedbackExample {
  originalDraft: string;
  feedbackNotes: string;
  editedVersion: string | null;
}

/**
 * Load active training examples, optionally filtered by category.
 * Supports lookup by email_address or location_id (backward compat).
 * Falls back to inherited location if configured in email_hub_settings.
 */
export async function loadTrainingExamples(
  locationId: string | null,
  category?: TrainingCategory,
  emailAddress?: string | null
): Promise<TrainingExample[]> {
  // If email_address provided, load by email + global examples
  if (emailAddress) {
    let query = supabase
      .from("training_examples")
      .select("*")
      .eq("is_active", true)
      .or(`email_address.eq.${emailAddress},email_address.is.null`)
      .order("created_at", { ascending: false });

    if (category) {
      query = query.eq("category", category);
    }

    const { data, error } = await query;
    if (error) {
      throw new Error(`Failed to load training examples: ${error.message}`);
    }
    return data ?? [];
  }

  // Fallback: load by location_id (backward compat)
  if (!locationId) return [];

  // Check if this location inherits training data from another
  const { data: settings } = await supabase
    .from("email_hub_settings")
    .select("inherit_training_from")
    .eq("location_id", locationId)
    .single();

  const targetLocationId = settings?.inherit_training_from ?? locationId;

  let query = supabase
    .from("training_examples")
    .select("*")
    .eq("is_active", true)
    .or(`location_id.eq.${targetLocationId},location_id.is.null`)
    .order("created_at", { ascending: false });

  if (category) {
    query = query.eq("category", category);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(`Failed to load training examples: ${error.message}`);
  }

  return data ?? [];
}

/**
 * Format training examples into few-shot prompt text.
 */
export function formatTrainingExamples(examples: TrainingExample[]): string {
  if (examples.length === 0) return "";

  const grouped = new Map<string, TrainingExample[]>();
  for (const ex of examples) {
    const group = grouped.get(ex.category) ?? [];
    group.push(ex);
    grouped.set(ex.category, group);
  }

  const sections: string[] = [];
  for (const [category, exs] of grouped) {
    const label = category.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    sections.push(`### ${label} Examples`);
    for (const ex of exs) {
      sections.push(`**Incoming email:**\n${ex.inbound_email}\n`);
      sections.push(`**Lynn's response:**\n${ex.ideal_response}\n`);
      if (ex.context_notes) {
        sections.push(`_Context: ${ex.context_notes}_\n`);
      }
      sections.push("---");
    }
  }

  return sections.join("\n");
}

/**
 * Load low-rated draft feedback (rating <= 2) that has notes.
 * Skips feedback already added as training examples.
 */
export async function loadDraftFeedback(): Promise<DraftFeedbackExample[]> {
  const { data: feedback, error } = await supabase
    .from("draft_feedback")
    .select("rating, feedback_notes, edited_version, added_as_training, draft_id")
    .lte("rating", 2)
    .not("feedback_notes", "is", null)
    .eq("added_as_training", false)
    .order("created_at", { ascending: false });

  if (error || !feedback || feedback.length === 0) return [];

  // Fetch the original draft body for each feedback entry
  const draftIds = feedback.map((f) => f.draft_id);
  const { data: drafts } = await supabase
    .from("email_drafts")
    .select("id, body_text")
    .in("id", draftIds);

  const draftMap = new Map((drafts ?? []).map((d) => [d.id, d.body_text]));

  return feedback
    .filter((f) => draftMap.has(f.draft_id) && draftMap.get(f.draft_id))
    .map((f) => ({
      originalDraft: draftMap.get(f.draft_id)!,
      feedbackNotes: f.feedback_notes!,
      editedVersion: f.edited_version ?? null,
    }));
}

/**
 * Format draft feedback into prompt text for the "what to avoid" section.
 */
export function formatDraftFeedback(feedback: DraftFeedbackExample[]): string {
  if (feedback.length === 0) return "";

  const sections: string[] = [];
  for (const fb of feedback) {
    sections.push(`**Draft that needed improvement:**\n${fb.originalDraft}\n`);
    sections.push(`**Feedback:** ${fb.feedbackNotes}\n`);
    if (fb.editedVersion) {
      sections.push(`**Corrected version:**\n${fb.editedVersion}\n`);
    }
    sections.push("---");
  }

  return sections.join("\n");
}
