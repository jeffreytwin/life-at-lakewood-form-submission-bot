import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase/client";

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

    const filePath = `${entityType}s/${entityId}.${ext}`;

    // Upload to Supabase Storage (upsert to overwrite existing)
    const arrayBuffer = await file.arrayBuffer();
    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(filePath, arrayBuffer, {
        contentType: file.type,
        upsert: true,
      });

    if (uploadError) {
      return NextResponse.json(
        { error: `Upload failed: ${uploadError.message}` },
        { status: 500 }
      );
    }

    // Get public URL with cache-busting timestamp
    const { data: urlData } = supabase.storage
      .from(BUCKET)
      .getPublicUrl(filePath);

    const photo_url = `${urlData.publicUrl}?v=${Date.now()}`;

    // Update the record in the database
    const table = entityType === "agent" ? "agents" : "locations";
    const { error: updateError } = await supabase
      .from(table)
      .update({ photo_url })
      .eq("id", entityId);

    if (updateError) {
      return NextResponse.json(
        { error: `DB update failed: ${updateError.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json({ photo_url });
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
