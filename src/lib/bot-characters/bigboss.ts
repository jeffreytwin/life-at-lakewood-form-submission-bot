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
      return `Got 'em, Colonel. ${event.leadName} is with ${event.agentName ?? "an agent"}. That's one in the bag.`;
    case "failed":
      return `Colonel — they slipped past me. ${event.leadName} got away. We'll catch the next one.`;
    case "new":
      return "New form submission on the line, Colonel. Fresh contact in the area.";
    case "manual":
      return "Going in solo on this one, Colonel? Roger that — I'll cover your six.";
    case "routing":
      return `Reaching out to ${event.agentName ?? "an agent"} now, Colonel. Should be the right operator for this.`;
    case "followup":
      return `${event.agentName ?? "The agent"} hasn't checked in yet. I'll signal again, Colonel — sometimes you've gotta wait out the brush.`;
    case "reroute":
      return `${event.agentName ?? "The agent"} didn't bite, Colonel. Switching to a fresh hand. Plenty of wildlife out here.`;
    case "owned_by_other":
      return `${event.agentName ?? "An agent"} already has eyes on this one, Colonel. I'll let ${pronoun(g, "object")} know we noticed.`;
    case "done":
      return "Mission's a wrap, Colonel. Good work.";
    case "text_me":
      return "Sending the file to your handheld, Colonel. Read it carefully.";
    case "bad_data":
      return `That one's a decoy, Colonel. ${event.leadName} flagged. Not every track's worth following.`;
    case "email_draft_new":
      return "New email, Colonel. The drafter has a reply ready — give it a once-over.";
    case "email_draft_approved":
      return "Roger. Putting it on the wire.";
    case "email_sent":
      return "Message away, Colonel. On to the next.";
  }
}

export const bigboss: BotCharacter = {
  id: "bigboss",
  displayName: "Big Boss",
  welcomeMessages: [
    "Colonel. Snake here.",
    "Reading you, Colonel.",
    "On the line, Colonel.",
    "Snake here. What's the situation?",
    "Colonel — I'm in position.",
    "Standing by, Colonel.",
    "Colonel. Awaiting orders.",
    "Snake here. Eyes open.",
    "Reading you loud and clear, Colonel.",
    "Colonel — let's see what the day brings.",
  ],
  // Sharing the codec opening with the others — same MGS callsign sound works.
  welcomeSound: "/sounds/codec-opening2.mp3",
  gifs: {
    standing: "/Big Boss - Standing V3.gif",
    // Big Boss uses Snake's box gifs for the routing-on/off transitions —
    // we don't have Big Boss equivalents and these stay Snake by design.
    inBox: "/in-box.gif",
    getInBox: "/get-in-box.gif",
    gettingOutOfBox: "/getting-out-of-box.gif",
    celebrating: "/Big Boss - Celebration.gif",
    sneaking: "/Big Boss - Crawling.gif",
  },
  // Tune size and celebration duration to taste once we see it in motion.
  gifSizeScale: 1.15,
  // Quiet-hours GIF reads small at the base scale; bumped further so it
  // has comparable visual weight to Ocelot's and Liquid's.
  sneakingSizeScale: 1.495,
  celebrationDurationMs: 11100,
  // Same nudge as Ocelot/Liquid so he lands in the same visual spot Snake
  // renders at in the routing toggle.
  avatarTransform: "translate(4px, 1px)",
  getMessage,
};
