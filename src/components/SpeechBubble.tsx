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
    case "owned_by_other":
      return `Colonel! This one's already assigned to ${event.agentName ?? "an agent"}. I'll ping the operative now.`;
  }
}

const CHAR_DELAY = 35; // ms per character — SNES typewriter speed
const DISPLAY_DURATION = 6000; // ms to show after fully typed

export default function SpeechBubble() {
  const [visible, setVisible] = useState(false);
  const [displayText, setDisplayText] = useState("");
  const fullText = useRef("");
  const charIndex = useRef(0);
  const typeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  useEffect(() => {
    const unsub = onLeadEvent((event) => {
      clearTimers();
      const msg = getMessage(event);
      fullText.current = msg;
      charIndex.current = 0;
      setDisplayText("");
      setVisible(true);
      // Start typewriter after a brief pause
      typeTimer.current = setTimeout(typeNext, 200);
    });
    return () => {
      unsub();
      clearTimers();
    };
  }, [clearTimers, typeNext]);

  if (!visible) return null;

  return (
    <div className="speech-bubble">
      <span className="speech-bubble-text">{displayText}</span>
      <span className="speech-bubble-cursor">_</span>
    </div>
  );
}
