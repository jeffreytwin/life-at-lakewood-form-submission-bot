import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase/client";
import { logger } from "@/lib/shared/logger";
import { labelPhotos, sortByRooms } from "@/lib/floorplans/photo-rooms";

export const dynamic = "force-dynamic";
// Every picture of the gallery is looked at; a gallery of thirty is a
// couple of requests with the pictures fetched alongside.
export const maxDuration = 300;

/**
 * POST /api/internal/floorplans/changes/:id/sort-photos
 * Body: { galleryImages?: string[] }
 *
 * Puts a plan's photos in the order the sites show them, using what the
 * pictures themselves show rather than what their file names say — for the
 * builders that name a picture nothing (Jeff, 2026-09-22). Asked for from
 * the edit overlay, so it sorts the list as it stands there, edits and all;
 * the queue row is not touched, and the order is saved with the rest when
 * the overlay is saved.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const body = await request.json().catch(() => null);
    const asked: unknown = body?.galleryImages;

    // The overlay's list where it sent one, else the row's own.
    let gallery: string[];
    if (Array.isArray(asked) && asked.every((u) => typeof u === "string")) {
      gallery = asked as string[];
    } else {
      const { data: change, error } = await supabase
        .from("fp_pending_changes")
        .select("proposed_record")
        .eq("id", id)
        .maybeSingle();
      if (error) throw error;
      if (!change) return NextResponse.json({ error: "Change not found" }, { status: 404 });
      const rec = (change.proposed_record ?? {}) as { galleryImages?: string[] };
      gallery = Array.isArray(rec.galleryImages) ? rec.galleryImages : [];
    }
    gallery = gallery.filter((url, i) => url && gallery.indexOf(url) === i);
    if (gallery.length < 2) return NextResponse.json({ galleryImages: gallery, placed: 0 });

    const labels = await labelPhotos(gallery);
    const ordered = sortByRooms(gallery, labels);
    const placed = gallery.filter((url) => labels.get(url)).length;
    logger.info("Floor plan photos sorted by what they show", { id, photos: gallery.length, placed });
    return NextResponse.json({ galleryImages: ordered.urls, galleryMeta: ordered.meta, placed });
  } catch (error) {
    logger.error("Failed to sort floor plan photos", {
      id,
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
