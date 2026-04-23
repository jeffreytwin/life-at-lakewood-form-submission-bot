import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase/client";
import { validateAdminAuth } from "@/lib/shared/admin-auth";
import { logger } from "@/lib/shared/logger";
import { resizeToThumbnail } from "@/lib/shared/resize-photo";

export const dynamic = "force-dynamic";

const BUCKET = "photos";

interface BackfillResult {
  entityType: "agent" | "location";
  id: string;
  status: "ok" | "skipped" | "failed";
  error?: string;
}

/**
 * POST /api/admin/backfill-photo-thumbnails
 *
 * Generates thumbnails for every agent/location that has a photo_url but
 * no photo_thumb_url. Safe to re-run — already-thumbnailed rows are
 * filtered out.
 *
 * Requires x-api-key: ADMIN_API_KEY.
 */
export async function POST(request: NextRequest) {
  const authError = validateAdminAuth(request);
  if (authError) return authError;

  try {
    const results: BackfillResult[] = [];

    for (const entityType of ["agent", "location"] as const) {
      const table = entityType === "agent" ? "agents" : "locations";
      const { data, error } = await supabase
        .from(table)
        .select("id, photo_url")
        .not("photo_url", "is", null)
        .is("photo_thumb_url", null);

      if (error) {
        logger.error("Backfill query failed", {
          entityType,
          error: error.message,
        });
        continue;
      }

      for (const row of data ?? []) {
        const result = await backfillOne(
          entityType,
          row.id as string,
          row.photo_url as string
        );
        results.push(result);
      }
    }

    const summary = {
      total: results.length,
      ok: results.filter((r) => r.status === "ok").length,
      skipped: results.filter((r) => r.status === "skipped").length,
      failed: results.filter((r) => r.status === "failed").length,
      results,
    };

    logger.info("Photo thumbnail backfill complete", summary);
    return NextResponse.json(summary);
  } catch (error) {
    logger.error("Photo thumbnail backfill failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}

async function backfillOne(
  entityType: "agent" | "location",
  id: string,
  photoUrl: string
): Promise<BackfillResult> {
  const table = entityType === "agent" ? "agents" : "locations";
  try {
    const res = await fetch(photoUrl);
    if (!res.ok) {
      return {
        entityType,
        id,
        status: "failed",
        error: `Fetch original failed: ${res.status}`,
      };
    }
    const originalBuffer = Buffer.from(await res.arrayBuffer());
    const thumbBuffer = await resizeToThumbnail(originalBuffer);

    const thumbPath = `${entityType}s/${id}_thumb.jpg`;
    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(thumbPath, thumbBuffer, {
        contentType: "image/jpeg",
        upsert: true,
      });
    if (uploadError) {
      return {
        entityType,
        id,
        status: "failed",
        error: `Thumb upload failed: ${uploadError.message}`,
      };
    }

    const { data: urlData } = supabase.storage
      .from(BUCKET)
      .getPublicUrl(thumbPath);
    const thumbPublicUrl = `${urlData.publicUrl}?v=${Date.now()}`;

    const { error: updateError } = await supabase
      .from(table)
      .update({ photo_thumb_url: thumbPublicUrl })
      .eq("id", id);
    if (updateError) {
      return {
        entityType,
        id,
        status: "failed",
        error: `DB update failed: ${updateError.message}`,
      };
    }

    return { entityType, id, status: "ok" };
  } catch (err) {
    return {
      entityType,
      id,
      status: "failed",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
