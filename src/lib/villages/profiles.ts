// How each site spells the village range fields (ranges.ts,
// VillageRangeProfile). Lakewood's AmenitiesbyVillage is the model the
// logical fields are named after; Wellen Park's HousesforSale-DynamicPages
// names them its own way and keeps its own methodology where it differs
// (Jeff, 2026-10-27): tags that read "2 Car" and "Single Family Homes",
// coach homes as their own filter, a one-line comma-separated home types
// text, and no dropdown fields.

import type { VillageRangeProfile } from "@/lib/villages/ranges";

export const LAKEWOOD_PROFILE: VillageRangeProfile = {
  name: "lakewood",
  fields: {
    priceRange: "priceRange",
    priceRangeDropdown: "priceRangeDropdown",
    priceRangeNew: "priceRangeNew",
    squareFootageRange: "squareFootageRange",
    bedrooms: "bedrooms",
    bedroomsNew: "bedroomsNew",
    bedroomsDropdown: "bedroomsDropdown",
    bathrooms: "bathrooms",
    bathroomsNew: "bathroomsNew",
    bathroomsDropdown: "bathroomsDropdown",
    garages: "garages",
    garagesNew: "garagesNew",
    garagesDropdown: "garagesDropdown",
    homeTypeNew: "homeTypeNew",
    homeTypesDropdown: "homeTypesDropdown",
    homeTypes: "homeTypes",
    hasListingsOrNewConstruction: "hasListingsOrNewConstruction",
    hasNewConstruction: "hasNewConstruction",
    buildYourHomeColor: "buildYourHomeColor",
  },
  titleKeys: ["title", "villagesTitle"],
  garageTagSuffix: "",
  homeTypes: [
    { kind: "single-family", tag: "Single Family Home", dropdown: "Single Family Home", display: "Single Family" },
    { kind: "villa", tag: "Villa", dropdown: "Attached Villas", display: "Villas" },
    { kind: "townhome", tag: "Townhome", dropdown: "Townhomes", display: "Townhomes" },
    { kind: "condominium", tag: "Condominium", dropdown: "Condominiums", display: "Condominiums" },
  ],
  // Lakewood has no coach home filter: a coach home is a condominium there.
  foldHomeTypes: { "coach-home": "condominium" },
  homeTypesSeparator: "\n",
};

export const WELLEN_PARK_PROFILE: VillageRangeProfile = {
  name: "wellen-park",
  fields: {
    priceRange: "priceRange",
    priceRangeDropdown: null,
    priceRangeNew: "priceRangeTags",
    squareFootageRange: "squareFeet",
    bedrooms: "bedroomRange",
    bedroomsNew: "bedroomTags",
    bedroomsDropdown: null,
    bathrooms: "bathroomRange",
    bathroomsNew: "bathroomTags",
    bathroomsDropdown: null,
    garages: "garageSizeRange",
    garagesNew: "garageSizeTags",
    garagesDropdown: null,
    homeTypeNew: "homeTypeTags",
    homeTypesDropdown: null,
    homeTypes: "homeTypes",
    hasListingsOrNewConstruction: "hasListingsOrNewConstruction",
    hasNewConstruction: "hasNewConstruction",
    buildYourHomeColor: "buildYourHomeColor",
  },
  // "Wellen Park Golf & Country Club" is the title; the plans and listings
  // call it "Wellen Park Country Club", its filtering name.
  titleKeys: ["title", "villageNameForFiltering"],
  garageTagSuffix: " Car",
  homeTypes: [
    { kind: "single-family", tag: "Single Family Homes", dropdown: "Single Family Homes", display: "Single Family" },
    { kind: "villa", tag: "Villas", dropdown: "Villas", display: "Villas" },
    { kind: "townhome", tag: "Townhomes", dropdown: "Townhomes", display: "Townhomes" },
    { kind: "condominium", tag: "Condominiums", dropdown: "Condominiums", display: "Condos" },
    { kind: "coach-home", tag: "Coach Homes", dropdown: "Coach Homes", display: "Coach Homes" },
  ],
  foldHomeTypes: {},
  homeTypesSeparator: ", ",
};
