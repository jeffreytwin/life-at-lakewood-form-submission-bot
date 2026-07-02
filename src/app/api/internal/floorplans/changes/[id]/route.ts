import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase/client";
import { logger } from "@/lib/shared/logger";

export const dynamic = "force-dynamic";

const EDITABLE_FIELDS = [
  "name",
  "priceDisplay",
  "beds",
  "baths",
  "sqft",
  "garages",
  "homeType",
] as const;

/**
 * PATCH /api/internal/floorplans/changes/:id
 * Body: { record: { name?, priceDisplay?, beds?, baths?, sqft?, garages?, homeType? } }
 *
 * Edits a PENDING change's proposed record before approval. Edited fields
 * are recorded as manual overrides (userEditedFields) so the nightly diff
 * will not propose reverting them to the builder's values.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const body = await request.json();
    const edits = body?.record ?? {};

    const { data: change, error: loadError } = await supabase
      .from("fp_pending_changes")
      .select("id, status, proposed_record, new_value")
      .eq("id", id)
      .maybeSingle();
    if (loadError) throw loadError;
    if (!change) return NextResponse.json({ error: "Change not found" }, { status: 404 });
    if (change.status !== "pending") {
      return NextResponse.json({ error: "Only pending changes can be edited" }, { status: 409 });
    }

    const record = { ...(change.proposed_record ?? {}) } as Record<string, unknown> & {
      userEditedFields?: string[];
    };
    const edited = new Set(record.userEditedFields ?? []);
    for (const field of EDITABLE_FIELDS) {
      if (field in edits && edits[field] !== record[field]) {
        record[field] = edits[field];
        edited.add(field);
      }
    }
    // Keep the numeric price in sync when the display price was edited.
    if (edited.has("priceDisplay") && typeof record.priceDisplay === "string") {
      const parsed = parseInt(record.priceDisplay.replace(/[^0-9]/g, ""), 10);
      record.price = Number.isFinite(parsed) ? parsed : null;
    }
    if (edited.has("sqft") && record.sqft != null) {
      const parsed = parseInt(String(record.sqft).replace(/[^0-9]/g, ""), 10);
      record.sqft = Number.isFinite(parsed) ? parsed : null;
    }
    record.userEditedFields = [...edited];

    const { data: updated, error } = await supabase
      .from("fp_pending_changes")
      .update({
        proposed_record: record,
        new_value: (record.priceDisplay as string) ?? change.new_value,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("status", "pending")
      .select("id, proposed_record")
      .maybeSingle();
    if (error) throw error;
    if (!updated) return NextResponse.json({ error: "Change is no longer pending" }, { status: 409 });
    return NextResponse.json(updated);
  } catch (error) {
    logger.error("Failed to edit floor plan change", {
      id,
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
