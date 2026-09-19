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
  "virtualTourUrl",
  "description",
  "relatedPlanName",
  "score",
] as const;

/**
 * PATCH /api/internal/floorplans/changes/:id
 * Body: { record: { name?, priceDisplay?, beds?, baths?, sqft?, garages?, homeType?, virtualTourUrl?, description?, relatedPlanName?, score? } }
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
      if (!(field in edits)) continue;
      if (field === "score") {
        // A person's number, not a builder value: it never counts as an override.
        const raw = String(edits.score ?? "").trim();
        const parsed = raw === "" ? null : Number(raw);
        if (parsed !== null && !Number.isFinite(parsed)) {
          return NextResponse.json({ error: "score must be a number" }, { status: 400 });
        }
        record.score = parsed;
        continue;
      }
      if (field === "sqft") {
        // The form shows "3,908" and the record holds 3908: compare as numbers,
        // or every save would mark an untouched value as an override.
        const digits = String(edits.sqft ?? "").replace(/[^0-9]/g, "");
        const parsed = digits ? parseInt(digits, 10) : null;
        if (parsed !== (record.sqft ?? null)) {
          record.sqft = parsed;
          edited.add("sqft");
        }
        continue;
      }
      // A blank in the form is the same as nothing in the record.
      const after = typeof edits[field] === "string" ? edits[field].trim() : edits[field];
      const before = record[field] ?? "";
      if (String(after ?? "") !== String(before)) {
        record[field] = after === "" ? null : after;
        edited.add(field);
      }
    }
    // Keep the numeric price in sync when the display price was edited.
    if (edited.has("priceDisplay") && typeof record.priceDisplay === "string") {
      const parsed = parseInt(record.priceDisplay.replace(/[^0-9]/g, ""), 10);
      record.price = Number.isFinite(parsed) ? parsed : null;
    }
    // Gallery edits: reorder/remove only — every entry must come from the
    // originally scraped image set. Position 0 is the main image.
    for (const galleryField of ["galleryImages", "blueprintImages"] as const) {
      const proposed = edits[galleryField];
      if (!Array.isArray(proposed)) continue;
      const original = new Set([
        ...((record.galleryImages as string[]) ?? []),
        ...((record.blueprintImages as string[]) ?? []),
        ...((record.primaryImage ? [record.primaryImage as string] : [])),
      ]);
      const cleaned = proposed.filter((u): u is string => typeof u === "string" && original.has(u));
      if (JSON.stringify(cleaned) !== JSON.stringify(record[galleryField] ?? [])) {
        record[galleryField] = cleaned;
        edited.add(galleryField);
      }
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
