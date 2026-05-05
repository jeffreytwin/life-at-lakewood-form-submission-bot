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
      return `Mission complete, Boss. ${event.leadName} is with ${event.agentName ?? "an agent"}.`;
    case "failed":
      return `Boss — we couldn't make the link. ${event.leadName} got away. We'll need a new angle.`;
    case "new":
      return "Movement on the line, Boss. New contact.";
    case "manual":
      return "Taking the shot yourself, Boss? Understood. I'll stand back.";
    case "routing":
      return `Reaching out to ${event.agentName ?? "an agent"} now, Boss. ${pronoun(g, "subject")}'s the right hand for this.`;
    case "followup":
      return `${event.agentName ?? "The agent"} hasn't responded. I'll prod ${pronoun(g, "object")} again — a good soldier follows up.`;
    case "reroute":
      return `${event.agentName ?? "The agent"} didn't pick up. Switching to a fresh contact. The mission continues.`;
    case "owned_by_other":
      return `${event.agentName ?? "An agent"} already has this one in hand, Boss. I'll let ${pronoun(g, "object")} know we saw it.`;
    case "done":
      return "Mission accomplished, Boss. Moving on.";
    case "text_me":
      return "Sending the file to your handheld, Boss. Read it carefully.";
    case "bad_data":
      return `Bad intel, Boss. ${event.leadName} flagged. We've all seen our share.`;
    case "email_draft_new":
      return "Incoming traffic, Boss. The drafter has a reply ready. Take a look before it goes out.";
    case "email_draft_approved":
      return "Approved. Putting it on the wire.";
    case "email_sent":
      return "Message away, Boss.";
  }
}

export const bigboss: BotCharacter = {
  id: "bigboss",
  displayName: "Big Boss",
  welcomeMessages: [
    "Boss. Reporting in.",
    "On the line, Boss.",
    "Operator's awake. Let's get to work.",
    "Boss. The wire's clear.",
    "Stand by, Boss.",
    "Long day ahead. Let's move.",
    "Boss. Standing by.",
    "Awaiting orders.",
    "On station. Ready when you are.",
    "Eyes on the field, Boss.",
  ],
  // Sharing the codec opening with the others — same MGS callsign sound works.
  welcomeSound: "/sounds/codec-opening2.mp3",
  gifs: {
    standing: "/Big Boss - Standing V2.gif",
    // Big Boss uses Snake's box gifs for the routing-on/off transitions —
    // we don't have Big Boss equivalents and these stay Snake by design.
    inBox: "/in-box.gif",
    getInBox: "/get-in-box.gif",
    gettingOutOfBox: "/getting-out-of-box.gif",
    celebrating: "/Big Boss - Celebration.gif",
    sneaking: "/Big Boss - Crawling.gif",
  },
  // Tune size and celebration duration to taste once we see it in motion.
  gifSizeScale: 1.25,
  // Quiet-hours GIF reads small at the base scale; bumped further so it
  // has comparable visual weight to Ocelot's and Liquid's.
  sneakingSizeScale: 1.625,
  celebrationDurationMs: 5000,
  // Same nudge as Ocelot/Liquid so he lands in the same visual spot Snake
  // renders at in the routing toggle.
  avatarTransform: "translate(4px, 3px)",
  getMessage,
};
