import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase/client";
import { logger } from "@/lib/shared/logger";
import { resizeToThumbnail } from "@/lib/shared/resize-photo";

export const dynamic = "force-dynamic";

const BUCKET = "photos";
const MAX_SIZE = 5 * 1024 * 1024; // 5MB

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const entityType = formData.get("type") as string | null; // "agent" or "location"
    const entityId = formData.get("id") as string | null;

    if (!file || !entityType || !entityId) {
      return NextResponse.json(
        { error: "Missing file, type, or id" },
        { status: 400 }
      );
    }

    if (!["agent", "location"].includes(entityType)) {
      return NextResponse.json(
        { error: "type must be 'agent' or 'location'" },
        { status: 400 }
      );
    }

    if (file.size > MAX_SIZE) {
      return NextResponse.json(
        { error: "File too large (max 5MB)" },
        { status: 400 }
      );
    }

    const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
    const allowedExts = ["jpg", "jpeg", "png", "webp", "gif"];
    if (!allowedExts.includes(ext)) {
      return NextResponse.json(
        { error: "Invalid file type. Allowed: jpg, png, webp, gif" },
        { status: 400 }
      );
    }

    const originalPath = `${entityType}s/${entityId}.${ext}`;
    const thumbPath = `${entityType}s/${entityId}_thumb.jpg`;

    // Upload original (upsert to overwrite existing)
    const originalBuffer = Buffer.from(await file.arrayBuffer());
    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(originalPath, originalBuffer, {
        contentType: file.type,
        upsert: true,
      });

    if (uploadError) {
      return NextResponse.json(
        { error: `Upload failed: ${uploadError.message}` },
        { status: 500 }
      );
    }

    // Generate and upload thumbnail. If resize fails we still want the
    // original upload to succeed — list views fall back to photo_url.
    let thumbPublicUrl: string | null = null;
    try {
      const thumbBuffer = await resizeToThumbnail(originalBuffer);
      const { error: thumbUploadError } = await supabase.storage
        .from(BUCKET)
        .upload(thumbPath, thumbBuffer, {
          contentType: "image/jpeg",
          upsert: true,
        });
      if (thumbUploadError) {
        logger.error("Thumbnail upload failed", {
          entityType,
          entityId,
          error: thumbUploadError.message,
        });
      } else {
        const { data: thumbUrlData } = supabase.storage
          .from(BUCKET)
          .getPublicUrl(thumbPath);
        thumbPublicUrl = `${thumbUrlData.publicUrl}?v=${Date.now()}`;
      }
    } catch (resizeErr) {
      logger.error("Thumbnail resize failed", {
        entityType,
        entityId,
        error: resizeErr instanceof Error ? resizeErr.message : String(resizeErr),
      });
    }

    // Get public URL for the original with cache-busting timestamp
    const { data: urlData } = supabase.storage
      .from(BUCKET)
      .getPublicUrl(originalPath);

    const photo_url = `${urlData.publicUrl}?v=${Date.now()}`;

    // Update the record in the database
    const table = entityType === "agent" ? "agents" : "locations";
    const { error: updateError } = await supabase
      .from(table)
      .update({
        photo_url,
        photo_thumb_url: thumbPublicUrl,
      })
      .eq("id", entityId);

    if (updateError) {
      return NextResponse.json(
        { error: `DB update failed: ${updateError.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json({
      photo_url,
      photo_thumb_url: thumbPublicUrl,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : String(error),
      },
      { status: 500 }
    );
  }
}
