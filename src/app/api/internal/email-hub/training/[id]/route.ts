import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase/client";

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { email_address, category, inbound_email, ideal_response, context_notes, is_active } = body;

    const updates: Record<string, unknown> = {};
    if (email_address !== undefined) updates.email_address = email_address;
    if (category !== undefined) updates.category = category;
    if (inbound_email !== undefined) updates.inbound_email = inbound_email;
    if (ideal_response !== undefined) updates.ideal_response = ideal_response;
    if (context_notes !== undefined) updates.context_notes = context_notes;
    if (is_active !== undefined) updates.is_active = is_active;

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "No fields to update" }, { status: 400 });
    }

    const { data, error } = await supabase
      .from("training_examples")
      .update(updates)
      .eq("id", id)
      .select()
      .single();

    if (error) throw error;
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Soft delete by setting is_active to false
    const { error } = await supabase
      .from("training_examples")
      .update({ is_active: false })
      .eq("id", id);

    if (error) throw error;
    return NextResponse.json({ status: "ok" });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
