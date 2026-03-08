"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { onLeadEvent, LeadEvent } from "@/lib/lead-events";

function getMessage(event: LeadEvent): string {
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
      return `Colonel, I'm pinging ${event.agentName ?? "an agent"} now. Let's see if they bite.`;
    case "followup":
      return `No response yet. Following up with ${event.agentName ?? "the agent"}. Let's see if they're awake.`;
    case "reroute":
      return `Didn't work out. Re-routing ${event.leadName} to ${event.agentName ?? "another agent"} now.`;
    case "owned_by_other":
      return `Colonel! This one's already assigned to ${event.agentName ?? "an agent"}. I'll ping the operative now.`;
  }
}

const WELCOME_MESSAGES = [
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
];

const WELCOME_SOUND = "/sounds/codec-opening2.mp3";

const CHAR_DELAY = 35; // ms per character — SNES typewriter speed
const DISPLAY_DURATION = 6000; // ms to show after fully typed

export default function SpeechBubble() {
  const [visible, setVisible] = useState(false);
  const [displayText, setDisplayText] = useState("");
  const fullText = useRef("");
  const charIndex = useRef(0);
  const typeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const welcomeShown = useRef(false);

  const clearTimers = useCallback(() => {
    if (typeTimer.current) clearTimeout(typeTimer.current);
    if (hideTimer.current) clearTimeout(hideTimer.current);
  }, []);

  const typeNext = useCallback(() => {
    if (charIndex.current < fullText.current.length) {
      charIndex.current++;
      setDisplayText(fullText.current.slice(0, charIndex.current));
      typeTimer.current = setTimeout(typeNext, CHAR_DELAY);
    } else {
      // Done typing — schedule hide
      hideTimer.current = setTimeout(() => setVisible(false), DISPLAY_DURATION);
    }
  }, []);

  const showMessage = useCallback((msg: string) => {
    clearTimers();
    fullText.current = msg;
    charIndex.current = 0;
    setDisplayText("");
    setVisible(true);
    typeTimer.current = setTimeout(typeNext, 200);
  }, [clearTimers, typeNext]);

  // Welcome message on mount
  useEffect(() => {
    if (welcomeShown.current) return;
    welcomeShown.current = true;

    const msg = WELCOME_MESSAGES[Math.floor(Math.random() * WELCOME_MESSAGES.length)];
    // Small delay so the component is fully rendered before the typewriter starts
    const t = setTimeout(() => {
      showMessage(msg);
      const audio = new Audio(WELCOME_SOUND);
      audio.volume = 0.6;
      audio.play().catch(() => {});
    }, 500);
    return () => clearTimeout(t);
  }, [showMessage]);

  useEffect(() => {
    const unsub = onLeadEvent((event) => {
      showMessage(getMessage(event));
    });
    return () => {
      unsub();
      clearTimers();
    };
  }, [clearTimers, showMessage]);

  if (!visible) return null;

  return (
    <div className="speech-bubble">
      <span className="speech-bubble-text">{displayText}</span>
      <span className="speech-bubble-cursor">_</span>
    </div>
  );
}
