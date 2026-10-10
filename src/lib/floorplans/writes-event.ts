// Said on the window when plans have just been handed to the approval
// worker, so the note under every page's title counts them at once
// (ApprovalWritesNote). Not a lead event: the character speaks on every one
// of those (SpeechBubble).
export const FLOORPLAN_WRITES_EVENT = "floorplans:writes";

/** Tells the note under the page's title that plans were just handed over. */
export function announceWrites(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(FLOORPLAN_WRITES_EVENT));
}
