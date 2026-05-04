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
      return `Colonel! I was able to transfer ${event.leadName} to ${event.agentName ?? "an agent"}.`;
    case "failed":
      return `Colonel! Bad news. I couldn't get ${event.leadName}'s submission out. I need backup!`;
    case "new":
      return "Colonel! Just spotted a new form submission. On it!";
    case "manual":
      return "Looks like you're on it. ....You're pretty good.";
    case "routing":
      return `Colonel, I'm pinging ${event.agentName ?? "an agent"} now. Let's see if ${pronoun(g, "subject")} bites.`;
    case "followup":
      return `No response yet. Following up with ${event.agentName ?? "the agent"}. Let's see if ${pronoun(g, "subject")}'s awake.`;
    case "reroute":
      return `Didn't work out. Re-routing ${event.leadName} to ${event.agentName ?? "another agent"} now.`;
    case "owned_by_other":
      return `Colonel! This one's already assigned to ${event.agentName ?? "an agent"}. I'll ping ${pronoun(g, "object")} now.`;
    case "done":
      return "I never doubted you for a second Colonel!";
    case "text_me":
      return "Texting you the details now Colonel. This file's pretty thick...";
    case "bad_data":
      return `Looks like a false flag operation Colonel. I marked ${event.leadName} as 'Bad Data'.`;
    case "email_draft_new":
      return "Colonel! Someone's reaching out via email. Our AI operative put together a draft. Better check it out...";
    case "email_draft_approved":
      return "Pinging the frontlines to get this message out ASAP. I'll let you know when that happens...";
    case "email_sent":
      return "Colonel! Just got word the email was sent! You're pretty good...";
  }
}

export const snake: BotCharacter = {
  id: "snake",
  displayName: "Solid Snake",
  welcomeMessages: [
    "Colonel! I thought you'd gone dark for a minute...",
    "Back already Colonel?",
    "The mission isn't over yet. Welcome back.",
    "Kept you waiting, huh? Welcome back.",
    "Let's use our CQC on these hand raises.",
    "Snake here… you're back online.",
    "Snake here… took you long enough.",
    "Can love really bloom...in a marketing tool?",
    "Snake here… welcome back.",
    "You're back. Let's move.",
    "Codec link established.",
    "Snake here. Ready for the next op.",
    "This is Snake. Systems ready.",
  ],
  welcomeSound: "/sounds/codec-opening2.mp3",
  gifs: {
    standing: "/standing-there.gif",
    inBox: "/in-box.gif",
    getInBox: "/get-in-box.gif",
    gettingOutOfBox: "/getting-out-of-box.gif",
    celebrating: "/celebration.gif",
    sneaking: "/sneaking.gif",
  },
  // Snake's sprites are taller than wide and the character sits in the
  // lower portion of each frame. Anchor cover-crops to the bottom so the
  // small avatars (schedule editor, modal photo, etc.) actually show him.
  avatarObjectPosition: "center bottom",
  getMessage,
};
