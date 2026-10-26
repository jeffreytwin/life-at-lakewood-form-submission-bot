// The village ranges switch, as the Hub's Listings page flips it.

import { supabase } from "@/lib/supabase/client";
import { errorMessage } from "@/lib/shared/errors";
import { HubError } from "@/lib/listings/hub";
import type { VillageRangesState } from "@/lib/villages/sync";

export interface VillageRangesSettings {
  village_ranges_enabled: boolean;
  village_ranges_state: VillageRangesState;
}

export async function setVillageRangesEnabled(enabled: unknown): Promise<VillageRangesSettings> {
  if (typeof enabled !== "boolean") throw new HubError("enabled must be true or false");
  const { data, error } = await supabase
    .from("system_settings")
    .update({ village_ranges_enabled: enabled })
    .eq("id", 1)
    .select("village_ranges_enabled, village_ranges_state")
    .single();
  if (error) throw new HubError(`village ranges switch: ${errorMessage(error)}`, 500);
  return data as VillageRangesSettings;
}
