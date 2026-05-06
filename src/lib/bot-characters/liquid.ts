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
      return `Excellent, Colonel — ${event.leadName} routed to ${event.agentName ?? "an agent"}. The strong always find their place.`;
    case "failed":
      return `Colonel — even the best of us hit a wall. ${event.leadName} got away. We regroup.`;
    case "new":
      return "A new form submission, Colonel. Let's see what they're made of.";
    case "manual":
      return "Going in alone, Colonel? Of course you are.";
    case "routing":
      return `Colonel, ${event.agentName ?? "an agent"} is on the line. ${pronoun(g, "subject")} knows what to do.`;
    case "followup":
      return `No reply yet. Pressing ${event.agentName ?? "the agent"} again — the strong don't wait around.`;
    case "reroute":
      return `That one slipped away, Colonel. Rotating — ${event.agentName ?? "another agent"} is next. The fittest survive.`;
    case "owned_by_other":
      return `Colonel — this one's already in ${event.agentName ?? "an agent"}'s grip. I'll let ${pronoun(g, "object")} know.`;
    case "done":
      return "A finishing blow, Colonel. Cleanly done.";
    case "text_me":
      return "Sending the file to your handheld, Colonel. Read it carefully.";
    case "bad_data":
      return `A pretender, Colonel. ${event.leadName} flagged. Not everyone is built for the field.`;
    case "email_draft_new":
      return "A new email, Colonel. The scribe has prepared a reply — read it before you sign.";
    case "email_draft_approved":
      return "Approved. I'll put it on the wire.";
    case "email_sent":
      return "Delivered, Colonel. Another mark.";
  }
}

export const liquid: BotCharacter = {
  id: "liquid",
  displayName: "Liquid Snake",
  welcomeMessages: [
    "Colonel. You return.",
    "Took your time, didn't you?",
    "The blood is up today, Colonel.",
    "I knew you'd come back. We're cut from the same cloth.",
    "Colonel — fate has more for us yet.",
    "Back already, Colonel? Excellent.",
    "The world doesn't run itself, Colonel.",
    "Colonel. Always punctual when it suits you.",
    "Welcome, Colonel. Let's get to work.",
    "Reporting in. The line is open.",
  ],
  // Sharing the codec opening with the others — same MGS callsign sound works.
  welcomeSound: "/sounds/codec-opening2.mp3",
  gifs: {
    standing: "/Liquid Snake - Standing.gif",
    // Liquid uses Snake's box gifs for the routing-on/off transitions —
    // we don't have Liquid equivalents and these stay Snake by design.
    inBox: "/in-box.gif",
    getInBox: "/get-in-box.gif",
    gettingOutOfBox: "/getting-out-of-box.gif",
    celebrating: "/Liquid Snake - Celebration.gif",
    sneaking: "/Liquid Snake - Crawling.gif",
  },
  // Tune size and celebration duration to taste once we see it in motion.
  gifSizeScale: 1.31,
  // Quiet-hours GIF reads small at the base scale; bumped further than
  // Ocelot's so it has comparable visual weight.
  sneakingSizeScale: 1.87,
  // Nudge Liquid ~4px right and ~3px down so he lands in the same visual
  // spot Snake renders at in the routing toggle and avatar circles.
  avatarTransform: "translate(10px, 8px)",
  celebrationDurationMs: 4680,
  getMessage,
};
