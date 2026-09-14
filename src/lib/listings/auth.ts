// Who may drive the listings engine by hand: the dashboard session (the
// Hub's own UI), the admin API key, or the cron secret. Mutating internal
// routes check this; the cron route checks the secret alone.

import { NextRequest, NextResponse } from "next/server";

export function authorizeEngineRequest(request: NextRequest): NextResponse | null {
  const session = request.cookies.get("session")?.value === "authenticated";
  const apiKey = request.headers.get("x-api-key");
  const adminOk = !!process.env.ADMIN_API_KEY && apiKey === process.env.ADMIN_API_KEY;
  const bearer = request.headers.get("authorization");
  const cronOk = !!process.env.CRON_SECRET && bearer === `Bearer ${process.env.CRON_SECRET}`;
  if (session || adminOk || cronOk) return null;
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}
