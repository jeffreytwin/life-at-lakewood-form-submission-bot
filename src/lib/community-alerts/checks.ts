// Every Community Alerts check in one place, for the cron routes and the
// Check now button. The sold-out check and the self-checks read the
// database only and run twice an hour; the new-neighborhood scan reads the
// home finders and runs once a day, or when a person asks.

import { checkSoldOuts, type SoldOutCheck } from "@/lib/community-alerts/sold-out";
import {
  refreshNewNeighborhoodAlerts,
  scanNewNeighborhoods,
  type NewNeighborhoodScan,
} from "@/lib/community-alerts/new-neighborhoods";

export interface ChecksResult {
  soldOut: SoldOutCheck;
  newNeighborhoods: NewNeighborhoodScan | null;
  selfChecks: { refreshed: number };
}

export async function runChecks({ scan }: { scan: boolean }): Promise<ChecksResult> {
  const soldOut = await checkSoldOuts();
  const newNeighborhoods = scan ? await scanNewNeighborhoods() : null;
  const selfChecks = await refreshNewNeighborhoodAlerts();
  return { soldOut, newNeighborhoods, selfChecks };
}
