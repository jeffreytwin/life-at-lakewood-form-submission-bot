import type { LeadEvent } from "@/lib/lead-events";
import type { CharacterId, HolidayId, HolidayLines } from "./types";

/**
 * What each character says while wearing each hat, on top of their everyday
 * lines. holidays.ts mixes these in for as long as the hat is on.
 *
 * The events with a holiday line are the ones the character celebrates, a
 * new form submission, the email ones and bad data. Anything that asks for
 * action keeps its everyday line, so a problem is never dressed up.
 *
 * A hat is worn for weeks, so no line here says that today is the day.
 * Holiday lines for an event say everything the everyday line says: the
 * bubble is the only place some of these events are explained.
 */

const agent = (event: LeadEvent) => event.agentName ?? "an agent";
const place = (event: LeadEvent, fallback: string) => event.communityName ?? fallback;

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
        email_draft_new: () =>
          "Colonel! Someone's reaching out via email, and luck's with us: our AI operative already has a draft. Better check it out...",
        email_draft_approved: () =>
          "Pinging the frontlines to get this message out. With a little luck, it won't be long...",
        email_sent: () =>
          "Colonel! Just got word the email was sent! Lucky them... you're pretty good.",
        bad_data: (e) =>
          `No pot of gold at the end of this one, Colonel. I marked ${e.leadName} as 'Bad Data'.`,
        community_sold_out_done: (e) =>
          `${place(e, "The neighborhood")} is squared away, Colonel! The website has moved on from new builds. Pot of gold secured!`,
        community_new_neighborhood_done: (e) =>
          `${place(e, "The new neighborhood")} is on the map, Colonel! Pages up, engines running. Greener pastures — mission complete!`,
        community_schools_done: (e) =>
          `${place(e, "The neighborhood")}'s schools are squared away, Colonel! Lucky families — they'll know exactly where they're headed.`,
        community_fee_check_done: (e) =>
          `Fee intel confirmed, Colonel! Every page has the right numbers, and that's not luck. ${place(e, "The fee check")}: mission complete!`,
        war_room_task_done: (e) =>
          `Objective secured, Colonel! "${e.leadName}" is done. Luck had nothing to do with it.`,
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
        email_draft_new: () =>
          "Colonel! Someone's reaching out via email. Our AI operative has a draft ready to launch. Better check it out...",
        email_draft_approved: () =>
          "Pinging the frontlines to get this message out. Fuse is lit, Colonel...",
        email_sent: () =>
          "Colonel! Just got word the email was sent! Up like a rocket.",
        bad_data: (e) =>
          `That one was a dud, Colonel. No spark. I marked ${e.leadName} as 'Bad Data'.`,
        community_sold_out_done: (e) =>
          `${place(e, "The neighborhood")} is squared away, Colonel! The website has moved on from new builds. Cue the fireworks!`,
        community_new_neighborhood_done: (e) =>
          `${place(e, "The new neighborhood")} is on the map, Colonel! Pages up, engines running. Plant the flag — mission complete!`,
        community_schools_done: (e) =>
          `${place(e, "The neighborhood")}'s schools are squared away, Colonel! Families will know exactly where they're headed. That deserves a sparkler.`,
        community_fee_check_done: (e) =>
          `Fee intel confirmed, Colonel! Every page has the right numbers. ${place(e, "The fee check")}: mission complete, with fireworks!`,
        war_room_task_done: (e) =>
          `Objective secured, Colonel! "${e.leadName}" is done. Light a firework for that one.`,
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
        email_draft_new: () =>
          "Colonel! Someone's reaching out via email. Thankfully, our AI operative put together a draft. Better check it out...",
        email_draft_approved: () =>
          "Pinging the frontlines to get this message out. I'd be thankful if they hurried...",
        email_sent: () =>
          "Colonel! Just got word the email was sent! One more thing to be thankful for.",
        bad_data: (e) =>
          `This one's all stuffing and no turkey, Colonel. I marked ${e.leadName} as 'Bad Data'.`,
        community_sold_out_done: (e) =>
          `${place(e, "The neighborhood")} is squared away, Colonel! The website has moved on from new builds. I'm thankful that's done.`,
        community_new_neighborhood_done: (e) =>
          `${place(e, "The new neighborhood")} is on the map, Colonel! Pages up, engines running. Another place at the table — mission complete!`,
        community_schools_done: (e) =>
          `${place(e, "The neighborhood")}'s schools are squared away, Colonel! Families will be thankful to know where they're headed.`,
        community_fee_check_done: (e) =>
          `Fee intel confirmed, Colonel! Every page has the right numbers. ${place(e, "The fee check")}: mission complete, and I'm thankful for it.`,
        war_room_task_done: (e) =>
          `Objective secured, Colonel! "${e.leadName}" is done. Thankful to cross that one off.`,
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
        email_draft_new: () =>
          "Colonel! Someone's reaching out via email. Our AI operative wrapped up a draft. Better check it out...",
        email_draft_approved: () =>
          "Pinging the frontlines to get this message out. Special delivery, Colonel...",
        email_sent: () =>
          "Colonel! Just got word the email was sent! Delivered faster than a sleigh.",
        bad_data: (e) =>
          `A lump of coal, Colonel. I marked ${e.leadName} as 'Bad Data'.`,
        community_sold_out_done: (e) =>
          `${place(e, "The neighborhood")} is squared away, Colonel! The website has moved on from new builds. All wrapped up!`,
        community_new_neighborhood_done: (e) =>
          `${place(e, "The new neighborhood")} is on the map, Colonel! Pages up, engines running. A present under the tree — mission complete!`,
        community_schools_done: (e) =>
          `${place(e, "The neighborhood")}'s schools are squared away, Colonel! Families will know exactly where they're headed. Consider it gift-wrapped.`,
        community_fee_check_done: (e) =>
          `Fee intel confirmed, Colonel! I checked the list twice. ${place(e, "The fee check")}: mission complete!`,
        war_room_task_done: (e) =>
          `Objective secured, Colonel! "${e.leadName}" is done. One more off Santa's list.`,
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
        email_draft_new: () =>
          "A new email, Colonel, and a lucky one: our scribe has already drafted a reply. Take a look.",
        email_draft_approved: () =>
          "Approved. I'll signal frontlines to put it in motion. Luck favors the prompt.",
        email_sent: () =>
          "The message has been delivered, Colonel. Lucky recipient. Beautiful.",
        bad_data: (e) =>
          `No luck in this chamber, Colonel. ${e.leadName} flagged as bad data and discarded.`,
        community_sold_out_done: (e) =>
          `${place(e, "The neighborhood")}: every round accounted for, Colonel. The new builds are gone and the site knows it. A lucky streak, well played.`,
        community_new_neighborhood_done: (e) =>
          `${place(e, "The new neighborhood")} is in our sights now, Colonel. Pages, listings, advertising. A four-leaf draw.`,
        community_schools_done: (e) =>
          `${place(e, "The neighborhood")}'s schools, set straight, Colonel. Luck? No. A clean shot.`,
        community_fee_check_done: (e) =>
          `${place(e, "The fee check")}, done, Colonel. Every figure dead center. Luck had no hand in it.`,
        war_room_task_done: (e) =>
          `"${e.leadName}"... done. One more objective down, Colonel. The luck holds. Beautiful.`,
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
        email_draft_new: () =>
          "A new email, Colonel. Our scribe has drafted a reply, fuse and all. Take a look before we light it.",
        email_draft_approved: () =>
          "Approved. I'll signal frontlines. The fuse is lit.",
        email_sent: () =>
          "The message has been delivered, Colonel. Up it went. Beautiful.",
        bad_data: (e) =>
          `A dud, Colonel. ${e.leadName} flagged as bad data and discarded. Not every rocket flies.`,
        community_sold_out_done: (e) =>
          `${place(e, "The neighborhood")}: every round accounted for, Colonel. The new builds are gone and the site knows it. A grand finale.`,
        community_new_neighborhood_done: (e) =>
          `${place(e, "The new neighborhood")} is in our sights now, Colonel. Pages, listings, advertising. Raise the flag.`,
        community_schools_done: (e) =>
          `${place(e, "The neighborhood")}'s schools, set straight, Colonel. A clean shot, with fireworks. Beautiful.`,
        community_fee_check_done: (e) =>
          `${place(e, "The fee check")}, done, Colonel. Every figure dead center. That deserves a salute.`,
        war_room_task_done: (e) =>
          `"${e.leadName}"... done. One more objective down, Colonel. Cue the fireworks.`,
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
        email_draft_new: () =>
          "A new email, Colonel. Thankfully, our scribe has drafted a reply. Words are weapons too — take a look.",
        email_draft_approved: () =>
          "Approved. I'll signal frontlines to put it in motion. They'll thank us.",
        email_sent: () =>
          "The message has been delivered, Colonel. Something to be thankful for.",
        bad_data: (e) =>
          `Nothing on this plate, Colonel. ${e.leadName} flagged as bad data and discarded.`,
        community_sold_out_done: (e) =>
          `${place(e, "The neighborhood")}: every round accounted for, Colonel. The new builds are gone and the site knows it. The table is cleared.`,
        community_new_neighborhood_done: (e) =>
          `${place(e, "The new neighborhood")} is in our sights now, Colonel. Pages, listings, advertising. A new seat at the table.`,
        community_schools_done: (e) =>
          `${place(e, "The neighborhood")}'s schools, set straight, Colonel. The families will be thankful. Beautiful.`,
        community_fee_check_done: (e) =>
          `${place(e, "The fee check")}, done, Colonel. Every figure dead center. I'm thankful for a steady hand.`,
        war_room_task_done: (e) =>
          `"${e.leadName}"... done. One more objective down, Colonel. Be thankful. I am.`,
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
        email_draft_new: () =>
          "A new email, Colonel. Our scribe has a reply wrapped and waiting. Take a look.",
        email_draft_approved: () =>
          "Approved. I'll signal frontlines. Special delivery.",
        email_sent: () =>
          "The message has been delivered, Colonel. Down the chimney. Beautiful.",
        bad_data: (e) =>
          `Coal, Colonel. ${e.leadName} flagged as bad data and discarded. Not every box holds a gift.`,
        community_sold_out_done: (e) =>
          `${place(e, "The neighborhood")}: every round accounted for, Colonel. The new builds are gone and the site knows it. Wrapped, with a bow.`,
        community_new_neighborhood_done: (e) =>
          `${place(e, "The new neighborhood")} is in our sights now, Colonel. Pages, listings, advertising. A fine gift.`,
        community_schools_done: (e) =>
          `${place(e, "The neighborhood")}'s schools, set straight, Colonel. Checked twice. Beautiful.`,
        community_fee_check_done: (e) =>
          `${place(e, "The fee check")}, done, Colonel. Every figure checked twice, and dead center.`,
        war_room_task_done: (e) =>
          `"${e.leadName}"... done. One more off the list, Colonel. Merry Christmas.`,
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
        email_draft_new: () =>
          "A new email, Colonel. Fortune smiles — the scribe has prepared a reply. Read it before you sign.",
        email_draft_approved: () =>
          "Approved. I'll put it on the wire. Luck goes with it.",
        email_sent: () =>
          "Delivered, Colonel. Fortune favors the swift.",
        bad_data: (e) =>
          `A pretender, Colonel. ${e.leadName} flagged as bad data. Their luck has run out.`,
        community_sold_out_done: (e) =>
          `${place(e, "The neighborhood")} is finished, Colonel, and the website changed with it. The strong make their own luck.`,
        community_new_neighborhood_done: (e) =>
          `${place(e, "The new neighborhood")} is ours now, Colonel. Another territory on the map, and greener than the last.`,
        community_schools_done: (e) =>
          `${place(e, "The neighborhood")}'s schools are right now, Colonel. That was precision, not luck.`,
        community_fee_check_done: (e) =>
          `${place(e, "The fee check")} is finished, Colonel. The numbers bow to us now. Luck was not required.`,
        war_room_task_done: (e) =>
          `"${e.leadName}" is finished, Colonel. Luck had no part in it.`,
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
        email_draft_new: () =>
          "A new email, Colonel. The scribe has prepared a reply — read it before we light the fuse.",
        email_draft_approved: () =>
          "Approved. I'll put it on the wire. The fuse is lit.",
        email_sent: () =>
          "Delivered, Colonel. Like a rocket.",
        bad_data: (e) =>
          `A dud, Colonel. ${e.leadName} flagged as bad data. Not every rocket is built to fly.`,
        community_sold_out_done: (e) =>
          `${place(e, "The neighborhood")} is finished, Colonel, and the website changed with it. Fire the rockets.`,
        community_new_neighborhood_done: (e) =>
          `${place(e, "The new neighborhood")} is ours now, Colonel. Another territory on the map. Plant the flag.`,
        community_schools_done: (e) =>
          `${place(e, "The neighborhood")}'s schools are right now, Colonel. A fitting salute to precision.`,
        community_fee_check_done: (e) =>
          `${place(e, "The fee check")} is finished, Colonel. The numbers bow to us now. Light the sky.`,
        war_room_task_done: (e) =>
          `"${e.leadName}" is finished, Colonel. Worthy of fireworks.`,
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
        email_draft_new: () =>
          "A new email, Colonel. Be thankful — the scribe has prepared a reply. Read it before you sign.",
        email_draft_approved: () =>
          "Approved. I'll put it on the wire. You may thank me later.",
        email_sent: () =>
          "Delivered, Colonel. For that, I am thankful. Briefly.",
        bad_data: (e) =>
          `A pretender, Colonel. ${e.leadName} flagged as bad data. No seat at this table.`,
        community_sold_out_done: (e) =>
          `${place(e, "The neighborhood")} is finished, Colonel, and the website changed with it. Nothing left on the plate.`,
        community_new_neighborhood_done: (e) =>
          `${place(e, "The new neighborhood")} is ours now, Colonel. Another territory on the map. The feast grows.`,
        community_schools_done: (e) =>
          `${place(e, "The neighborhood")}'s schools are right now, Colonel. The families may thank us.`,
        community_fee_check_done: (e) =>
          `${place(e, "The fee check")} is finished, Colonel. The numbers bow to us now. Be thankful.`,
        war_room_task_done: (e) =>
          `"${e.leadName}" is finished, Colonel. For that, I am thankful.`,
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
        email_draft_new: () =>
          "A new email, Colonel. The scribe has a reply wrapped and ready — read it before you sign.",
        email_draft_approved: () =>
          "Approved. I'll put it on the wire. No sleigh required.",
        email_sent: () =>
          "Delivered, Colonel. Merry Christmas to them.",
        bad_data: (e) =>
          `A pretender, Colonel. ${e.leadName} flagged as bad data. Straight onto the naughty list.`,
        community_sold_out_done: (e) =>
          `${place(e, "The neighborhood")} is finished, Colonel, and the website changed with it. Wrapped and delivered.`,
        community_new_neighborhood_done: (e) =>
          `${place(e, "The new neighborhood")} is ours now, Colonel. Another territory on the map. Consider it a gift.`,
        community_schools_done: (e) =>
          `${place(e, "The neighborhood")}'s schools are right now, Colonel. Checked twice. Naturally.`,
        community_fee_check_done: (e) =>
          `${place(e, "The fee check")} is finished, Colonel. The numbers bow to us now. Every one checked twice.`,
        war_room_task_done: (e) =>
          `"${e.leadName}" is finished, Colonel. One fewer on the list.`,
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
        email_draft_new: () =>
          "New email, Colonel. Lucky break — the drafter has a reply ready. Give it a once-over.",
        email_draft_approved: () =>
          "Roger. Putting it on the wire. Luck go with it.",
        email_sent: () =>
          "Message away, Colonel. Luck's holding.",
        bad_data: (e) =>
          `That one's a decoy, Colonel. ${e.leadName} flagged as bad data. No gold at the end of that trail.`,
        community_sold_out_done: (e) =>
          `${place(e, "The neighborhood")}'s work is done, Colonel. Every item squared away. Good work — and a little luck.`,
        community_new_neighborhood_done: (e) =>
          `${place(e, "The new neighborhood")} is up and running, Colonel. Another one on the map. Green country. Good work.`,
        community_schools_done: (e) =>
          `${place(e, "The neighborhood")}'s schools are squared away, Colonel. Lucky families. Good work.`,
        community_fee_check_done: (e) =>
          `${place(e, "The fee check")} is squared away, Colonel. Good work. No luck needed.`,
        war_room_task_done: (e) =>
          `"${e.leadName}" — objective complete, Colonel. Luck's on our side.`,
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
        email_draft_new: () =>
          "New email, Colonel. The drafter has a reply ready to launch — give it a once-over.",
        email_draft_approved: () =>
          "Roger. Putting it on the wire. Fuse is lit.",
        email_sent: () =>
          "Message away, Colonel. Went up like a flare.",
        bad_data: (e) =>
          `That one's a dud, Colonel. ${e.leadName} flagged as bad data. No spark in it.`,
        community_sold_out_done: (e) =>
          `${place(e, "The neighborhood")}'s work is done, Colonel. Every item squared away. Send up the fireworks.`,
        community_new_neighborhood_done: (e) =>
          `${place(e, "The new neighborhood")} is up and running, Colonel. Another one on the map. Flag's planted. Good work.`,
        community_schools_done: (e) =>
          `${place(e, "The neighborhood")}'s schools are squared away, Colonel. Good work. That's worth a firework.`,
        community_fee_check_done: (e) =>
          `${place(e, "The fee check")} is squared away, Colonel. Good work. Enjoy the fireworks.`,
        war_room_task_done: (e) =>
          `"${e.leadName}" — objective complete, Colonel. That's worth a firework.`,
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
        email_draft_new: () =>
          "New email, Colonel. Thankfully the drafter has a reply ready — give it a once-over.",
        email_draft_approved: () =>
          "Roger. Putting it on the wire. Much obliged.",
        email_sent: () =>
          "Message away, Colonel. Thankful for a clear line.",
        bad_data: (e) =>
          `That one's a decoy, Colonel. ${e.leadName} flagged as bad data. No turkey on that trail.`,
        community_sold_out_done: (e) =>
          `${place(e, "The neighborhood")}'s work is done, Colonel. Every item squared away. The table's cleared. Good work.`,
        community_new_neighborhood_done: (e) =>
          `${place(e, "The new neighborhood")} is up and running, Colonel. Another one on the map. Thankful for that. Good work.`,
        community_schools_done: (e) =>
          `${place(e, "The neighborhood")}'s schools are squared away, Colonel. Families will be thankful. Good work.`,
        community_fee_check_done: (e) =>
          `${place(e, "The fee check")} is squared away, Colonel. Good work. Grateful to have it done.`,
        war_room_task_done: (e) =>
          `"${e.leadName}" — objective complete, Colonel. Thankful for that one.`,
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
        email_draft_new: () =>
          "New email, Colonel. The drafter has a reply wrapped up — give it a once-over.",
        email_draft_approved: () =>
          "Roger. Putting it on the wire. Special delivery.",
        email_sent: () =>
          "Message away, Colonel. Delivered like a present.",
        bad_data: (e) =>
          `That one's a decoy, Colonel. ${e.leadName} flagged as bad data. Lump of coal.`,
        community_sold_out_done: (e) =>
          `${place(e, "The neighborhood")}'s work is done, Colonel. Every item squared away. All wrapped up. Good work.`,
        community_new_neighborhood_done: (e) =>
          `${place(e, "The new neighborhood")} is up and running, Colonel. Another one on the map. Early present. Good work.`,
        community_schools_done: (e) =>
          `${place(e, "The neighborhood")}'s schools are squared away, Colonel. Checked twice. Good work.`,
        community_fee_check_done: (e) =>
          `${place(e, "The fee check")} is squared away, Colonel. Checked the list twice. Good work.`,
        war_room_task_done: (e) =>
          `"${e.leadName}" — objective complete, Colonel. One more off the list.`,
      },
    },
  },
};
