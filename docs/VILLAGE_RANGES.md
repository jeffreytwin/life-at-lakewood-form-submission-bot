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
spacing, dash style and "&" vs "and". Nineteen fields, in the formats the
site's page code already filters on (Jeff, 2026-10-26: so a buyer can
narrow villages by price, size, bedrooms, bathrooms, garages and home type).
The table below is Lakewood's spelling; each site has a profile
(`src/lib/villages/profiles.ts`) naming its own keys and words, and keeps
its own methodology where it differs (see "Sites" below):

| Field | Example |
|---|---|
| `priceRange` | `$300s - $2M+` (one bucket alone: `$1M+`; both ends in the millions: `$1M - $2M+`, one plus sign) |
| `priceRangeDropdown` | `Show All Price Ranges, $300s, $400s, ..., $900s, $1M+, $2M+` |
| `priceRangeNew` (tags) | `["$300s", "$400s", ..., "$900s", "1M+", "2M+"]` |
| `squareFootageRange` | `2,300 - 4,700 square feet` (nearest 100) |
| `bedrooms` | `2 - 6` (one value alone: `3`) |
| `bedroomsNew` (tags) | `["2", "3", "4", "5", "6"]`, every whole number low to high |
| `bedroomsDropdown` | `2, 3, 4, 5, 6, Show All` |
| `bathrooms` | `2 - 4.5` (halves kept) |
| `bathroomsNew` (tags) | `["2", "3", "4"]`, whole numbers from the floor of each end |
| `bathroomsDropdown` | `2, 3, 4, Show All` |
| `garages` | `2 - 3 Car` (one value alone: `3 Car`; a known no-garage low end reads `0 - 3 Car`) |
| `garagesNew` (tags) | `["2", "3"]` (0 is never a tag) |
| `garagesDropdown` | `2, 3, Show All` |
| `homeTypeNew` (tags) | `["Single Family Home", "Villa", "Townhome", "Condominium"]`, the page's filter values |
| `homeTypesDropdown` | `Single Family Home, Attached Villas, Townhomes, Condominiums, Show All` |
| `homeTypes` | the display text, one type a line: `Single Family`, `Villas`, `Townhomes`, `Condominiums` |
| `hasListingsOrNewConstruction` | `true` while the village has a plan or a listing for sale, `false` otherwise; the villages page hides a `false` village (Jeff, 2026-10-26) |
| `buildYourHomeColor` | `#2C9E37` (green) while the village has a floor plan for sale, `#A0A09F` (grey) otherwise: the Build Your Home button's colour, in the collection's own two values |
| `hasNewConstruction` | `true` while the village has a floor plan for sale, `false` otherwise, for the new construction filter (Jeff, 2026-10-26) |

A price bucket is a hundred-thousand up to $999,999 and a whole million
from there, consecutive from the lowest price to the highest. The
`squareFootageRange` (TEXT), `hasListingsOrNewConstruction` (BOOLEAN) and
`hasNewConstruction` (BOOLEAN) fields are added to the collection by the
first run that finds any missing.

Where the counts come from: floor plans carry beds, baths, the builder's
garage text ("3 car") and home type ("Attached Villa"); listings carry
bedrooms, full and half baths (2 full + 1 half is 2.5; the MLS total
integer, which counts a half as a whole, is the fallback), `GarageSpaces`
(0 when `GarageYN` is false, unknown when both are blank, and unknown too
when the listing claims a garage with 0 spaces, which is an agent's blank) and the RESO
`PropertySubType`. Home types map to the four filter values: Single Family
Home or Residence; Villa and Attached Villa; Townhome and Townhouse;
Condominium and Coach Home. A type outside those is left out, never
guessed. Counts of 0 bedrooms or bathrooms, or beyond 12, are left out as
data errors.

An item is written only when a field differs from the range, and each
group of fields needs its own data: a village with prices but no bedroom
counts gets its price fields and nothing else. A tag list is never written
empty. An item with nothing for sale keeps every range it has (never
blanked) and gets exactly one write: both availability flags set to
`false`, so the villages page can hide it, and the Build Your Home colour
grey; the flags go back to `true` with the first plan or listing. A village with homes but no item of that name is
reported, not created. An empty read of the inventory (no plans and no
listings at all) writes nothing, so a broken mirror can never hide every
village. Wellen Park and Parrish
join `VILLAGE_RANGE_TARGETS` (`src/lib/villages/sync.ts`) once their
neighborhoods collections carry the same four fields.

## Sites

| | Life At Lakewood | Life in Wellen Park | Life At Parrish |
|---|---|---|---|
| Collection | `AmenitiesbyVillage` | `HousesforSale-DynamicPages` ("Neighborhoods") | `HousesforSale-DynamicPages` ("Neighborhoods") |
| Village name | `title`, then `villagesTitle` | `title`, then `villageNameForFiltering` ("Wellen Park Country Club" is the filtering name of "Wellen Park Golf & Country Club") | as Wellen Park |
| Tags fields | `priceRangeNew`, `bedroomsNew`, `bathroomsNew`, `garagesNew`, `homeTypeNew` | `priceRangeTags`, `bedroomTags`, `bathroomTags`, `garageSizeTags`, `homeTypeTags` | as Wellen Park |
| Range texts | `bedrooms`, `bathrooms`, `garages`, `squareFootageRange` | `bedroomRange`, `bathroomRange`, `garageSizeRange`, `squareFeet` | as Wellen Park |
| Square feet | `1,500 - 3,700 square feet` | `1,500 - 3,700 square feet` | `1,500 - 3,700` (no suffix) |
| Dropdown texts | `priceRangeDropdown`, `bedroomsDropdown`, ... | none (not written) | none |
| Garage tags | `"2"`, `"3"` | `"2 Car"`, `"3 Car"` | `"2 Car"`, `"3 Car"` |
| Home type tags | `Single Family Home`, `Villa`, `Townhome`, `Condominium`; a coach home counts as a condominium | `Single Family Homes`, `Villas`, `Townhomes`, `Condominiums`, `Coach Homes` (their own filter) | as Wellen Park |
| `homeTypes` text | one type a line: `Single Family`, `Villas`, `Townhomes`, `Condominiums` | one line, comma separated: `Single Family, Condos, Coach Homes` | as Wellen Park |
| Button colours | green `#2C9E37`, grey `#A0A09F` | green `#2C9E37`, grey `#A0A09F` | green `#2C9E37`, grey `#BEBEBE` |
| Village aliases | none | none | "Crosswind Ranch" is the row "Crosswind"; "Del Webb Explore North River Ranch" is "Del Webb Explore" |

Price, bedroom and bathroom formats and the two flags are the same on all
three. Village names match ignoring case, spacing, dash style, apostrophes
("River's Reach" is "Rivers Reach") and "&" vs "and"; a profile's aliases
rename what the plans or listings call a village to what its row is called,
so the two become one range. Wellen Park's draft villages (Westlake,
Madera, Deer Park as of 2026-10-27) are matched like any other: one with
plans for sale is filled in, one with nothing is flagged false; the API
never changes a row's draft or published state. Parrish's fallback fields
(`priceRangeFallback` and friends) serve something else and are not
touched; The Towns at Firethorn and Firethorn are separate communities
there (Jeff, 2026-10-27).

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
