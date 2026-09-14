import { supabase } from "../client";

/**
 * Display name for a location, or null when the id is missing or unknown.
 * Callers fall back to the default community name.
 */
export async function getLocationName(
  locationId: string | null
): Promise<string | null> {
  if (!locationId) return null;

  const { data, error } = await supabase
    .from("locations")
    .select("name")
    .eq("id", locationId)
    .maybeSingle();

  if (error) throw error;
  return data?.name ?? null;
}
