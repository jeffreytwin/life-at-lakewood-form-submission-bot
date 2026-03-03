import { NextRequest, NextResponse } from "next/server";
import { getAllAgents, createAgent, updateAgent } from "@/lib/supabase/queries/agents";
import { validateAdminAuth } from "@/lib/shared/admin-auth";
import { logger } from "@/lib/shared/logger";

export async function GET(request: NextRequest) {
  const authError = validateAdminAuth(request);
  if (authError) return authError;

  try {
    const agents = await getAllAgents();
    return NextResponse.json(agents);
  } catch (error) {
    logger.error("Failed to fetch agents", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const authError = validateAdminAuth(request);
  if (authError) return authError;

  try {
    const body = await request.json();
    const agent = await createAgent(body);
    return NextResponse.json(agent, { status: 201 });
  } catch (error) {
    logger.error("Failed to create agent", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  const authError = validateAdminAuth(request);
  if (authError) return authError;

  try {
    const body = await request.json();
    const { id, ...updates } = body;

    if (!id) {
      return NextResponse.json({ error: "Missing agent id" }, { status: 400 });
    }

    const agent = await updateAgent(id, updates);
    return NextResponse.json(agent);
  } catch (error) {
    logger.error("Failed to update agent", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
