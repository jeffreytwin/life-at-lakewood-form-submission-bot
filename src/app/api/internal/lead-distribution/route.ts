import { NextResponse } from "next/server";
import { sfQuery, isSalesforceConfigured } from "@/lib/salesforce/client";

export const dynamic = "force-dynamic";

interface LeadCountRecord {
  Owner: { Name: string };
  expr0: number;
}

export async function GET() {
  if (!isSalesforceConfigured()) {
    return NextResponse.json(
      { error: "Salesforce is not configured" },
      { status: 503 }
    );
  }

  try {
    const result = await sfQuery<LeadCountRecord>(
      "SELECT Owner.Name, COUNT(Id) FROM Lead WHERE CreatedDate = THIS_MONTH GROUP BY Owner.Name ORDER BY Owner.Name"
    );

    const distribution = result.records.map((r) => ({
      agentName: r.Owner.Name,
      leadCount: r.expr0,
    }));

    return NextResponse.json({
      distribution,
      asOf: new Date().toISOString(),
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Failed to fetch lead distribution from Salesforce",
        details:
          error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
