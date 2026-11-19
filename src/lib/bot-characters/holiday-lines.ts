import type { LeadEvent } from "@/lib/lead-events";
import type { CharacterId, HolidayId, HolidayLines } from "./types";

/**
 * What each character says while wearing each hat, on top of their everyday
 * lines. holidays.ts mixes these in for as long as the hat is on.
 *
 * A hat is worn for weeks, so no line here says that today is the day.
 * Holiday lines for an event say everything the everyday line says: the
 * bubble is the only place some of these events are explained.
 */

const agent = (event: LeadEvent) => event.agentName ?? "an agent";

export const HOLIDAY_LINES: Record<CharacterId, Record<HolidayId, HolidayLines>> = {
  snake: {
    stpatrick: {
      welcome: [
        "Colonel! Top o' the morning. The hat was not my idea.",
        "Snake here. Luck's on our side this month, Colonel.",
        "Colonel, the clovers are sneaking better than I am.",
        "Wearing green, Colonel. Best camouflage I've had all year.",
      ],
      events: {
        new: () => "Colonel! New form submission. Must be the luck of the Irish. On it!",
        accepted: (e) => `Colonel! ${e.leadName} is with ${agent(e)}. Who needs a pot of gold?`,
        done: () => "I never doubted you, Colonel. Luck had nothing to do with it.",
        floorplans_cleared: () =>
          "Colonel! That was the last floor plan. Pot of gold secured — mission complete!",
      },
    },
    unclesam: {
      welcome: [
        "Colonel! Stars, stripes, and a codec link. Welcome back.",
        "Snake here. Those fireworks are friendly, right Colonel?",
        "Hard to sneak in this hat, Colonel. Worth it.",
        "Colonel! I was told there'd be a cookout after this mission.",
      ],
      events: {
        new: () => "Colonel! New form submission, lighting up like a firework. On it!",
        accepted: (e) => `Colonel! ${e.leadName} is with ${agent(e)}. Cue the fireworks.`,
        done: () => "I never doubted you, Colonel. That deserves a firework or two.",
        floorplans_cleared: () =>
          "Colonel! That was the last floor plan. Light the fireworks — mission complete!",
      },
    },
    pilgrim: {
      welcome: [
        "Colonel! I'm thankful you're back online.",
        "Snake here. Save me a plate, Colonel.",
        "Colonel, I've eaten worse than turkey in the field. Much worse.",
        "Kept you waiting, huh? Blame the pie.",
      ],
      events: {
        new: () => "Colonel! New form submission. One more thing to be thankful for. On it!",
        accepted: (e) => `Colonel! ${e.leadName} is with ${agent(e)}. I'm thankful for that one.`,
        done: () => "I never doubted you, Colonel. Thankful to have you on the codec.",
        floorplans_cleared: () =>
          "Colonel! That was the last floor plan. The plate is clean — mission complete!",
      },
    },
    santa: {
      welcome: [
        "Colonel! Merry Christmas. Don't mention the hat.",
        "Snake here. Infiltrating by chimney this time, Colonel.",
        "Colonel, I asked Santa for a bigger cardboard box.",
        "Kept you waiting, huh? Happy holidays, Colonel.",
      ],
      events: {
        new: () => "Colonel! New form submission. An early present. On it!",
        accepted: (e) => `Colonel! ${e.leadName} delivered to ${agent(e)}. Gift-wrapped.`,
        done: () => "I never doubted you, Colonel. You're on the nice list.",
        floorplans_cleared: () =>
          "Colonel! That was the last floor plan. All wrapped up — mission complete!",
      },
    },
  },

  ocelot: {
    stpatrick: {
      welcome: [
        "Welcome back, Colonel. I make my own luck — but I'll take the clover.",
        "Green suits a gunslinger, Colonel. Don't you think?",
        "Colonel. Six chambers, four leaves. I like those odds.",
        "The luck of the Irish, Colonel. Let's spend it wisely.",
      ],
      events: {
        new: () => "A new form submission, Colonel. Lucky us. Let's see how this hand plays out.",
        accepted: (e) => `${e.leadName} routed to ${agent(e)}, Colonel. Luck? No. Skill. Beautiful.`,
        done: () => "A clean shot, Colonel. Luck had nothing to do with it.",
        floorplans_cleared: () =>
          "Every floor plan accounted for, Colonel. A four-leaf finish. Beautiful.",
      },
    },
    unclesam: {
      welcome: [
        "Welcome back, Colonel. Fireworks — almost as fine a smell as gunpowder.",
        "Stars and stripes, Colonel. A showman's colors.",
        "Colonel. The fuses are lit. Let's put on a show.",
        "Fireworks, Colonel — the only shots everyone applauds.",
      ],
      events: {
        new: () => "A new form submission, Colonel. The fuse is lit. Let's see how this hand plays out.",
        accepted: (e) => `${e.leadName} routed to ${agent(e)}, Colonel. Now that deserves fireworks.`,
        done: () => "A clean shot, Colonel. The crowd would cheer, if they knew.",
        floorplans_cleared: () =>
          "Every floor plan accounted for, Colonel. A grand finale. Beautiful.",
      },
    },
    pilgrim: {
      welcome: [
        "Welcome back, Colonel. I'm thankful for a steady hand.",
        "Colonel. A feast awaits — after the work.",
        "This hat, Colonel? A gunslinger respects a good buckle.",
        "Gratitude, Colonel. A rare thing in our line of work.",
      ],
      events: {
        new: () => "A new form submission at the table, Colonel. Let's see how this hand plays out.",
        accepted: (e) => `${e.leadName} routed to ${agent(e)}, Colonel. Something to be thankful for.`,
        done: () => "A clean shot, Colonel. I'm thankful to have witnessed it.",
        floorplans_cleared: () =>
          "Every floor plan accounted for, Colonel. The table is cleared. Beautiful.",
      },
    },
    santa: {
      welcome: [
        "Season's greetings, Colonel. The cylinder's full.",
        "Colonel. I've checked the list twice. I never miss.",
        "Red suits me, Colonel. It always has.",
        "Merry Christmas, Colonel. Let's see what's under the tree.",
      ],
      events: {
        new: () => "A new form submission, Colonel. An early gift. Let's unwrap it.",
        accepted: (e) => `${e.leadName} routed to ${agent(e)}, Colonel. Delivered like a present. Beautiful.`,
        done: () => "A clean shot, Colonel. Consider it my gift to you.",
        floorplans_cleared: () =>
          "Every floor plan accounted for, Colonel. All wrapped, with a bow. Beautiful.",
      },
    },
  },

  liquid: {
    stpatrick: {
      welcome: [
        "Colonel. The weak rely on luck. Still — the clover stays.",
        "Green, Colonel. The color of envy. They should envy us.",
        "Luck is in the genes, Colonel. Some of us got more of it.",
        "You return, Colonel. Fortune favors us today.",
      ],
      events: {
        new: () => "A new form submission, Colonel. Let's see if luck is on their side.",
        accepted: (e) => `${e.leadName} routed to ${agent(e)}, Colonel. The strong make their own luck.`,
        done: () => "A finishing blow, Colonel. Luck had no part in it.",
        floorplans_cleared: () =>
          "The floor plan queue is empty, Colonel. That was not luck. That was us.",
      },
    },
    unclesam: {
      welcome: [
        "Colonel. Independence — now there's a cause I understand.",
        "Fireworks, Colonel. A fitting salute.",
        "You return, Colonel. The rockets are ready.",
        "An American hat on a British accent, Colonel. Say nothing.",
      ],
      events: {
        new: () => "A new form submission, Colonel. Let's see if they earn the fireworks.",
        accepted: (e) => `${e.leadName} routed to ${agent(e)}, Colonel. Light the sky.`,
        done: () => "A finishing blow, Colonel. Worthy of fireworks.",
        floorplans_cleared: () => "The floor plan queue is empty, Colonel. Fire the rockets.",
      },
    },
    pilgrim: {
      welcome: [
        "Colonel. Even I can be thankful. Briefly.",
        "You return, Colonel. The feast can wait.",
        "The strong eat first, Colonel. Pass the turkey.",
        "Thankful, Colonel? For capable allies. That is all.",
      ],
      events: {
        new: () =>
          "A new form submission, Colonel. Another place at the table. Let's see what they're made of.",
        accepted: (e) => `${e.leadName} routed to ${agent(e)}, Colonel. Be thankful — I am.`,
        done: () => "A finishing blow, Colonel. For that, I am thankful.",
        floorplans_cleared: () =>
          "The floor plan queue is empty, Colonel. Nothing left on the plate.",
      },
    },
    santa: {
      welcome: [
        "Colonel. 'Tis the season. Don't expect carols.",
        "You return, Colonel. Merry Christmas — now, to work.",
        "Naughty or nice, Colonel? I know which list I'm on.",
        "The hat stays, Colonel. We will not discuss it.",
      ],
      events: {
        new: () => "A new form submission, Colonel. Let's see what's inside the wrapping.",
        accepted: (e) => `${e.leadName} routed to ${agent(e)}, Colonel. Delivered. No sleigh required.`,
        done: () => "A finishing blow, Colonel. Merry Christmas.",
        floorplans_cleared: () =>
          "The floor plan queue is empty, Colonel. Every last one, wrapped and delivered.",
      },
    },
  },

  bigboss: {
    stpatrick: {
      welcome: [
        "Colonel. Snake here. Found a four-leaf clover in the brush.",
        "Reading you, Colonel. Green's good cover out here.",
        "Luck's a fine thing, Colonel. I'll keep my eyes open anyway.",
        "Standing by, Colonel. The clovers are with us.",
      ],
      events: {
        new: () => "New form submission on the line, Colonel. Could be our lucky day.",
        accepted: (e) => `Got 'em, Colonel. ${e.leadName} is with ${agent(e)}. A little luck never hurts.`,
        done: () => "Mission's a wrap, Colonel. Good work — and a bit of luck.",
        floorplans_cleared: () =>
          "That's every floor plan squared away, Colonel. Luck of the Irish. Mission complete.",
      },
    },
    unclesam: {
      welcome: [
        "Colonel. Snake here. Fireworks overhead — friendly ones.",
        "Reading you, Colonel. Stars and stripes are flying.",
        "Standing by, Colonel. Someone's got the grill going.",
        "Colonel — quite a hat. I'm told it's regulation this time of year.",
      ],
      events: {
        new: () => "New form submission on the line, Colonel. Went up like a flare.",
        accepted: (e) => `Got 'em, Colonel. ${e.leadName} is with ${agent(e)}. That's worth a firework.`,
        done: () => "Mission's a wrap, Colonel. Good work. Enjoy the fireworks.",
        floorplans_cleared: () =>
          "That's every floor plan squared away, Colonel. Send up the fireworks. Mission complete.",
      },
    },
    pilgrim: {
      welcome: [
        "Colonel. Snake here. Thankful for a clear line.",
        "Reading you, Colonel. There's turkey at base camp — no hunt required.",
        "Standing by, Colonel. Something smells good back at camp.",
        "Colonel — grateful for good people out here.",
      ],
      events: {
        new: () => "New form submission on the line, Colonel. One more to be thankful for.",
        accepted: (e) => `Got 'em, Colonel. ${e.leadName} is with ${agent(e)}. Thankful for that one.`,
        done: () => "Mission's a wrap, Colonel. Good work. Grateful to have you.",
        floorplans_cleared: () =>
          "That's every floor plan squared away, Colonel. The table's cleared. Mission complete.",
      },
    },
    santa: {
      welcome: [
        "Colonel. Snake here. Merry Christmas.",
        "Reading you, Colonel. Reindeer tracks on the roof.",
        "Standing by, Colonel. Happy holidays.",
        "Colonel — the hat keeps my ears warm. No further comment.",
      ],
      events: {
        new: () => "New form submission on the line, Colonel. Early present.",
        accepted: (e) => `Got 'em, Colonel. ${e.leadName} is with ${agent(e)}. Wrapped and delivered.`,
        done: () => "Mission's a wrap, Colonel. Good work. Merry Christmas.",
        floorplans_cleared: () =>
          "That's every floor plan squared away, Colonel. All wrapped up. Mission complete.",
      },
    },
  },
};
