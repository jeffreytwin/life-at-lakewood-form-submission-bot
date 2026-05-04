import type { BotCharacter } from "./types";
import type { LeadEvent } from "@/lib/lead-events";

function pronoun(gender: "male" | "female" | null | undefined, form: "subject" | "object" | "possessive"): string {
  if (gender === "female") return form === "subject" ? "she" : form === "object" ? "her" : "her";
  if (gender === "male") return form === "subject" ? "he" : form === "object" ? "him" : "his";
  return form === "subject" ? "they" : form === "object" ? "them" : "their";
}

function getMessage(event: LeadEvent): string {
  const g = event.agentGender;
  switch (event.type) {
    case "accepted":
      return `Excellent work, Colonel. ${event.leadName} routed to ${event.agentName ?? "an agent"}. Another piece falls into place.`;
    case "failed":
      return `Colonel — even my finest play hit a wall. ${event.leadName} slipped through the cracks. We'll need to regroup.`;
    case "new":
      return "A new mark on the board, Colonel. Let's see how this hand plays out.";
    case "manual":
      return "Going in alone, Colonel? Reckless… and beautiful.";
    case "routing":
      return `Drawing from the deck, Colonel — ${event.agentName ?? "an agent"}. Let's see if ${pronoun(g, "subject")} answers the call.`;
    case "followup":
      return `Silence on the line. I'll prod ${event.agentName ?? "the agent"} again — patience is its own weapon.`;
    case "reroute":
      return `That round missed, Colonel. Spinning the cylinder — ${event.agentName ?? "another agent"} is up. Plenty of chambers left.`;
    case "owned_by_other":
      return `Colonel — this one's already in ${event.agentName ?? "an agent"}'s holster. I'll let ${pronoun(g, "object")} know we noticed.`;
    case "done":
      return "A clean shot, Colonel. As expected from a man of your caliber.";
    case "text_me":
      return "Sending the dossier to your handheld, Colonel. The file is heavy with detail.";
    case "bad_data":
      return `An impostor, Colonel. ${event.leadName} flagged and discarded. Not every shell is loaded.`;
    case "email_draft_new":
      return "An incoming letter, Colonel. Our scribe has drafted a reply. Words are weapons too — take a look.";
    case "email_draft_approved":
      return "Approved. I'll signal frontlines to put it in motion.";
    case "email_sent":
      return "The message has been delivered, Colonel. Beautiful.";
  }
}

export const ocelot: BotCharacter = {
  id: "ocelot",
  displayName: "Revolver Ocelot",
  welcomeMessages: [
    "Welcome back, Colonel. The cylinder's full.",
    "Punctual as always, Colonel.",
    "Ah — Colonel. Let's see how the cards fall today.",
    "Codec live. Try not to keep me waiting next time.",
    "Colonel. A man who appreciates a good shot.",
    "Returning to the field, Colonel. Excellent.",
    "Patience is a weapon, Colonel. Use it well.",
    "Beautiful timing, Colonel.",
    "Colonel — every shot tells a story. Let's write one.",
    "Reporting in, Colonel. The board is set.",
    "Steady hand, Colonel. The day's just beginning.",
  ],
  // Sharing the codec opening with Snake — same MGS callsign sound works for both.
  welcomeSound: "/sounds/codec-opening2.mp3",
  gifs: {
    // Ocelot uses Snake's box gifs for the routing-on/off transitions
    // — we don't have Ocelot equivalents and the user opted to leave those alone.
    standing: "/Revolver Ocelot - Standing.gif",
    inBox: "/in-box.gif",
    getInBox: "/get-in-box.gif",
    gettingOutOfBox: "/getting-out-of-box.gif",
    celebrating: "/Revolver Ocelot - Celebration.gif",
    sneaking: "/Revolver Ocelot - Crawling.gif",
  },
  // Default 1.0 keeps Ocelot at the same render size as Snake. Bump up
  // here if his GIFs look noticeably smaller than Snake's in practice.
  gifSizeScale: 1.25,
  getMessage,
};
