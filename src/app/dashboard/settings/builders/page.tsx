import { redirect } from "next/navigation";

/**
 * Builder Connections moved out of Settings and in beside the other Floor
 * Plans pages (Jeff, 2026-09-22). Bookmarks and older links land here.
 */
export default function BuilderConnectionsMoved() {
  redirect("/dashboard/floor-plans/connections");
}
