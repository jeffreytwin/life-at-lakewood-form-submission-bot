import { supabase } from "@/lib/supabase/client";
import type { TrainingExample, TrainingCategory } from "@/lib/supabase/types";

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
