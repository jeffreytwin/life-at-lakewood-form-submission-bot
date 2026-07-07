"use client";

import { useEffect, useState, useRef, useCallback, useImperativeHandle, forwardRef } from "react";
import { onLeadEvent } from "@/lib/lead-events";
import { getActiveCharacter, ensureScheduleLoaded } from "@/lib/bot-characters";

const CHAR_DELAY = 35; // ms per character — SNES typewriter speed
const DISPLAY_DURATION = 6000; // ms to show after fully typed

export interface SpeechBubbleHandle {
  /** Replay the welcome line + codec sound, same as on page load. */
  playWelcome: () => void;
}

const SpeechBubble = forwardRef<SpeechBubbleHandle>(function SpeechBubble(_props, ref) {
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

  const playWelcome = useCallback(() => {
    const character = getActiveCharacter();
    const messages = character.welcomeMessages;
    const msg = messages[Math.floor(Math.random() * messages.length)];
    showMessage(msg);
    const audio = new Audio(character.welcomeSound);
    audio.volume = 0.6;
    audio.play().catch(() => {});
  }, [showMessage]);

  useImperativeHandle(ref, () => ({ playWelcome }), [playWelcome]);

  // Welcome message on mount — waits for the schedule to load so we use
  // today's actual character and not the default fallback.
  useEffect(() => {
    if (welcomeShown.current) return;
    welcomeShown.current = true;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    ensureScheduleLoaded().then(() => {
      if (cancelled) return;
      timer = setTimeout(() => {
        playWelcome();
      }, 500);
    });

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [playWelcome]);

  useEffect(() => {
    const unsub = onLeadEvent((event) => {
      const character = getActiveCharacter();
      showMessage(character.getMessage(event));
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
});

export default SpeechBubble;
