# Village price and square footage ranges

What a buyer can get in each neighborhood right now, written to the site's
villages collection so the village pages and their filters say the same
thing as the inventory (Jeff, 2026-10-26: "we are helping people narrow
things down for what's available right now").

## Where the numbers come from

Both of the site's inventory collections, as the pipeline mirrors them:

- **Floor Plans V2** (`FloorPlansV2`): `fp_floor_plans` rows that are in Wix
  (`wix_record_id` set) and not removed. The mirror is written when a change
  is approved, so it says what the collection says.
- **Homes for Sale** (`HousesforSale`): `ls_site_listings` rows in state
  `live`, priced and sized from `ls_listings`.

A village's range is the low and the high across both. Prices under
$100,000 and sizes under 300 square feet are data errors (a lot, a blank
read as 0) and are left out. Nothing historical: a removed plan or a sold
home is not in either set.

## What is written

Lakewood's villages are the `AmenitiesbyVillage` items, matched by `title`
(then `villagesTitle`) to the village name the rows carry, ignoring case,
spacing, dash style and "&" vs "and". Four fields, in the formats the
site's page code already filters on:

| Field | Example |
|---|---|
| `priceRange` | `$300s - $2M+` (one bucket alone: `$1M+`) |
| `priceRangeDropdown` | `Show All Price Ranges, $300s, $400s, ..., $900s, $1M+, $2M+` |
| `priceRangeNew` (tags) | `["$300s", "$400s", ..., "$900s", "1M+", "2M+"]` |
| `squareFootageRange` | `2,300 - 4,700 square feet` (nearest 100) |

A bucket is a hundred-thousand up to $999,999 and a whole million from
there, consecutive from the lowest price to the highest. The
`squareFootageRange` field is added to the collection (TEXT) by the first
run that finds it missing.

An item is written only when a field differs from the range. An item with
nothing for sale is left as it is (never blanked), and a village with homes
but no item of that name is reported, not created. Wellen Park and Parrish
join `VILLAGE_RANGE_TARGETS` (`src/lib/villages/sync.ts`) once their
neighborhoods collections carry the same four fields.

## When it runs

- When a floor plan sync cycle completes (`floorplans/nightly.ts`).
- When the approval worker has written plans and emptied its line
  (`floorplans/approvals.ts`).
- After a listings run that inserted, updated or deleted rows
  (`listings/tick.ts`).
- Every two hours on its own cron, `/api/cron/village-ranges`, as the
  safety net behind the three.

Every run is idempotent. All of them do nothing until
`system_settings.village_ranges_enabled` is true (migration 085).

## Looking before it writes

`GET /api/internal/villages/ranges?domain=lifeatlakewood.com` is the
preview: every item whose range moved with before and after, the ones left
alone, the villages with no item, and whether the square footage field
would be added. It reads Wix and writes nothing, switch on or off.
`POST /api/internal/villages/ranges` with `{ "domain": "..." }` runs the
sync now regardless of the switch. Both take the dashboard session, the
admin API key or the cron secret.
