import { NextResponse } from "next/server";
import { logger } from "@/lib/shared/logger";
import { describeError } from "@/lib/shared/describe-error";
import { recentScans, runSchoolZoneScan } from "@/lib/school-zones/scan";
import { listPlaces } from "@/lib/school-zones/places";

export const dynamic = "force-dynamic";
// Every village on every site is looked up; a scan takes a few minutes.
export const maxDuration = 800;

/** GET /api/internal/community-alerts/school-zones: the latest scans and the addresses given by hand. */
export async function GET() {
  try {
    const [scans, places] = await Promise.all([recentScans(), listPlaces()]);
    return NextResponse.json({ scans, places });
  } catch (error) {
    logger.error("Failed to read the school zone scans", { error: describeError(error) });
    return NextResponse.json({ error: describeError(error) }, { status: 500 });
  }
}

/** POST /api/internal/community-alerts/school-zones: the Run the scan now button, October's scan on demand. */
export async function POST() {
  try {
    return NextResponse.json(await runSchoolZoneScan("hub"));
  } catch (error) {
    logger.error("School zone scan failed", { error: describeError(error) });
    return NextResponse.json({ error: describeError(error) }, { status: 500 });
  }
}
