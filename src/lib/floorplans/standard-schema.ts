// The one Floor Plans V2 schema every site carries (Jeff, 2026-09-19:
// labels and field names identical on every site, "Neighborhood" rather
// than "Village"). The keys and types are what the phase 2 script created
// the collections with on 2026-07-02 (Parrish's legacy schema with its
// warts fixed, plus the provenance fields and the blueprint gallery); the
// labels are the legacy collections' human ones. Settings → Sites compares
// every site's collection to this and aligns it, and the snapshot build
// applies the labels and any missing field. To change the standard, edit
// the JSON, then align each site.

import standard from "./standard-floor-plan-schema.json";
import type { FieldSpec } from "./collection-schema";

export const STANDARD_COLLECTION_ID = "FloorPlansV2";
export const STANDARD_FLOOR_PLAN_FIELDS: FieldSpec[] = standard as FieldSpec[];
