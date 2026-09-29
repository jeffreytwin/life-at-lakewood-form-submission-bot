import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase/client";
import { logger } from "@/lib/shared/logger";
import { HOME_TYPES, isHomeType, standardGarages } from "@/lib/floorplans/standardize";
import { normKey, type NormalizedPlan } from "@/lib/floorplans/types";
import { picturesAdded, picturesRemoved, primaryReplaced } from "@/lib/floorplans/pictures";

/**
 * Whether a base plan of this name exists for the scope: live, or waiting
 * in the queue. A quick move-in given such a name is tied to it; one given
 * a name nobody has stays unmatched and waits for the plan to be created
 * (the overlay's "Create floor plan" button).
 */
async function basePlanExists(scope: { site_id: string; community_id: string; builder_id: string }, planKey: string): Promise<boolean> {
  const { data: live } = await supabase
    .from("fp_floor_plans")
    .select("id")
    .match(scope)
    .eq("plan_key", planKey)
    .eq("quick_move_in", false)
    .is("removed_at", null)
    .limit(1);
  if (live?.length) return true;
  const { data: queued } = await supabase
    .from("fp_pending_changes")
    .select("id, proposed_record")
    .match(scope)
    .eq("plan_key", planKey)
    .eq("status", "pending")
    .limit(5);
  return (queued ?? []).some((q) => (q.proposed_record as { quickMoveIn?: boolean } | null)?.quickMoveIn !== true);
}

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
/** One queued change whole, for the edit overlay: the list leaves its heaviest fields out (changes/route.ts). */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { data, error } = await supabase
    .from("fp_pending_changes")
    .select("id, status, change_type, site_id, community_id, builder_id, plan_key, proposed_record")
    .eq("id", id)
    .maybeSingle();
  if (error) {
    logger.error("Failed to read floor plan change", { id, error: error.message });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
  if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });
  // The pictures the change adds to the live plan, for the overlay to mark
  // (Jeff, 2026-09-28). A new plan's are all new, and none are marked.
  let addedPictures: string[] = [];
  // A quick move-in's one picture, where the change puts another in its place.
  let replacedPrimary: string | null = null;
  // And the live plan's pictures the change leaves out, marked in red (Jeff, 2026-09-29).
  let removedPictures: { photos: string[]; drawings: string[] } = { photos: [], drawings: [] };
  if (data.change_type === "update") {
    const { data: live } = await supabase
      .from("fp_floor_plans")
      .select("record")
      .match({ site_id: data.site_id, community_id: data.community_id, builder_id: data.builder_id, plan_key: data.plan_key })
      .is("removed_at", null)
      .maybeSingle();
    addedPictures = picturesAdded(live?.record as Partial<NormalizedPlan> | null, data.proposed_record as Partial<NormalizedPlan> | null);
    replacedPrimary = primaryReplaced(live?.record as Partial<NormalizedPlan> | null, data.proposed_record as Partial<NormalizedPlan> | null);
    removedPictures = picturesRemoved(live?.record as Partial<NormalizedPlan> | null, data.proposed_record as Partial<NormalizedPlan> | null);
  }
  return NextResponse.json({ id: data.id, status: data.status, proposed_record: data.proposed_record, addedPictures, replacedPrimary, removedPictures });
}

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
      .select("id, status, change_type, field_changed, proposed_record, new_value, site_id, community_id, builder_id, plan_key")
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
        // 1 to 10 as the freelancers used it, 11 for a plan that must come first (Jeff, 2026-09-21).
        if (parsed !== null && (!Number.isInteger(parsed) || parsed < 1 || parsed > 11)) {
          return NextResponse.json({ error: "score must be a whole number from 1 to 11" }, { status: 400 });
        }
        record.score = parsed;
        continue;
      }
      if (field === "homeType") {
        const wanted = typeof edits.homeType === "string" ? edits.homeType.trim() : "";
        if (wanted && !isHomeType(wanted)) {
          return NextResponse.json({ error: `homeType must be one of: ${HOME_TYPES.join(", ")}` }, { status: 400 });
        }
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
      // A blank in the form is the same as nothing in the record; garages
      // read "2 car" however they were typed ("2", "two car garage").
      const typed = typeof edits[field] === "string" ? edits[field].trim() : edits[field];
      const after = field === "garages" && typeof typed === "string" ? (standardGarages(typed) ?? "") : typed;
      const before = record[field] ?? "";
      if (String(after ?? "") !== String(before)) {
        record[field] = after === "" ? null : after;
        edited.add(field);
      }
    }
    // Keep the numeric price in sync when the display price was edited; a
    // typed price is the person's, no longer a quick move-in's stand-in.
    if (edited.has("priceDisplay") && typeof record.priceDisplay === "string") {
      const parsed = parseInt(record.priceDisplay.replace(/[^0-9]/g, ""), 10);
      record.price = Number.isFinite(parsed) ? parsed : null;
      record.priceFromHome = null;
    }
    // The builder's own picture sets are kept beside the record (pictures.ts
    // stamps them at queue time; older rows get them here, before any edit),
    // so a picture removed by mistake can be brought back.
    if (!Array.isArray(record.scrapedGalleryImages)) record.scrapedGalleryImages = [...((record.galleryImages as string[]) ?? [])];
    if (!Array.isArray(record.scrapedBlueprintImages)) record.scrapedBlueprintImages = [...((record.blueprintImages as string[]) ?? [])];
    if (edits.restorePictures === true) {
      record.galleryImages = [...(record.scrapedGalleryImages as string[])];
      record.blueprintImages = [...(record.scrapedBlueprintImages as string[])];
      edited.delete("galleryImages");
      edited.delete("blueprintImages");
    }
    // Gallery edits: reorder/remove only — every entry must come from the
    // builder's picture set. Position 0 is the main image.
    for (const galleryField of ["galleryImages", "blueprintImages"] as const) {
      const proposed = edits[galleryField];
      if (!Array.isArray(proposed)) continue;
      const original = new Set([
        ...((record.galleryImages as string[]) ?? []),
        ...((record.blueprintImages as string[]) ?? []),
        ...((record.scrapedGalleryImages as string[]) ?? []),
        ...((record.scrapedBlueprintImages as string[]) ?? []),
        ...((record.primaryImage ? [record.primaryImage as string] : [])),
      ]);
      const cleaned = proposed.filter((u): u is string => typeof u === "string" && original.has(u));
      if (JSON.stringify(cleaned) !== JSON.stringify(record[galleryField] ?? [])) {
        record[galleryField] = cleaned;
        edited.add(galleryField);
      }
    }

    record.userEditedFields = [...edited];

    // A quick move-in's base plan, as typed: tied to the plan when the site
    // has one by that name, else left unmatched for a plan to be created.
    if (record.quickMoveIn === true && "relatedPlanName" in edits) {
      const key = normKey(String(record.relatedPlanName ?? ""));
      const scope = { site_id: change.site_id, community_id: change.community_id, builder_id: change.builder_id };
      if (key && (await basePlanExists(scope, key))) {
        record.relatedPlanKey = key;
        record.relatedPlanMatch = "plan-name";
      } else {
        record.relatedPlanKey = null;
        record.relatedPlanMatch = "unmatched";
      }
    }

    // The score outlives the plan (fp_plan_scores): a Reset and the next
    // Run bring it back rather than asking for it again.
    if ("score" in edits) {
      const identity = {
        site_id: change.site_id,
        community_id: change.community_id,
        builder_id: change.builder_id,
        plan_key: change.plan_key,
      };
      if (typeof record.score === "number") {
        const { error: scoreError } = await supabase
          .from("fp_plan_scores")
          .upsert({ ...identity, score: record.score, updated_at: new Date().toISOString() }, { onConflict: "site_id,community_id,builder_id,plan_key" });
        if (scoreError) throw scoreError;
      } else {
        const { error: scoreError } = await supabase.from("fp_plan_scores").delete().match(identity);
        if (scoreError) throw scoreError;
      }
    }

    // A new plan's row, and a price change's, show the price; every other
    // field's row keeps its own value. Writing the price over a
    // description's or a gallery's broke what the queue showed, the alert
    // an approval sends, and the check that keeps a rejected change from
    // coming back (Kolter's Bahia with Bonus, 2026-09-28).
    const priceRow = change.change_type === "add" || change.field_changed === "price";
    const { data: updated, error } = await supabase
      .from("fp_pending_changes")
      .update({
        proposed_record: record,
        new_value: priceRow ? ((record.priceDisplay as string) ?? change.new_value) : change.new_value,
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
