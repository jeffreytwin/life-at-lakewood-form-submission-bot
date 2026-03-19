import { NextRequest, NextResponse } from "next/server";
import { resyncByQuery } from "@/lib/gmail/sync-inbox";

/**
 * POST /api/internal/email-hub/resync
 * Manually re-sync specific messages by Gmail search query.
 *
 * Body: { accountEmail: string, query: string, maxResults?: number }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { accountEmail, query, maxResults } = body;

    if (!accountEmail || !query) {
      return NextResponse.json(
        { error: "accountEmail and query are required" },
        { status: 400 }
      );
    }

    const result = await resyncByQuery(accountEmail, query, maxResults ?? 10);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
