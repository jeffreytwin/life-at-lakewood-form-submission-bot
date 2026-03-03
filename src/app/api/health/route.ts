import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    status: "ok",
    service: "life-at-lakewood-form-routing",
    timestamp: new Date().toISOString(),
  });
}
