import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase/client";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const emailAddress = searchParams.get("email_address");
    const category = searchParams.get("category");

    let query = supabase
      .from("training_examples")
      .select("*")
      .eq("is_active", true)
      .order("created_at", { ascending: false });

    if (emailAddress) {
      query = query.eq("email_address", emailAddress);
    }
    if (category) {
      query = query.eq("category", category);
    }

    const { data, error } = await query;
    if (error) throw error;
    return NextResponse.json(data ?? []);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email_address, category, inbound_email, ideal_response, context_notes } = body;

    if (!category || !inbound_email || !ideal_response) {
      return NextResponse.json(
        { error: "category, inbound_email, and ideal_response are required" },
        { status: 400 }
      );
    }

    const { data, error } = await supabase
      .from("training_examples")
      .insert({
        email_address: email_address || null,
        category,
        inbound_email,
        ideal_response,
        context_notes: context_notes || null,
        is_active: true,
      })
      .select()
      .single();

    if (error) throw error;
    return NextResponse.json(data, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
