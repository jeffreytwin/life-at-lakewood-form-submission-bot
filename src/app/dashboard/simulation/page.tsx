"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useRef, useCallback } from "react";

const OTOCON_MESSAGE =
  "Otocon here!  The simulations are ready.  Feel free to try them out!";
const CHAR_DELAY = 35;
const DISPLAY_DURATION = 8000;
const TALKING_GIF_DURATION = 4900; // full gif loop length in ms

export default function SimulationPage() {
  const router = useRouter();
  const [bubbleVisible, setBubbleVisible] = useState(false);
  const [displayText, setDisplayText] = useState("");
  const [isTalking, setIsTalking] = useState(false);
  const fullText = useRef(OTOCON_MESSAGE);
  const charIndex = useRef(0);
  const typeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const talkTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimers = useCallback(() => {
    if (typeTimer.current) clearTimeout(typeTimer.current);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    if (talkTimer.current) clearTimeout(talkTimer.current);
  }, []);

  const typeNext = useCallback(() => {
    if (charIndex.current < fullText.current.length) {
      charIndex.current++;
      setDisplayText(fullText.current.slice(0, charIndex.current));
      typeTimer.current = setTimeout(typeNext, CHAR_DELAY);
    } else {
      // Text is done — hide bubble after a while
      hideTimer.current = setTimeout(() => setBubbleVisible(false), DISPLAY_DURATION);
    }
  }, []);

  useEffect(() => {
    // Delay start so layout is settled and bubble doesn't jump
    const startDelay = setTimeout(() => {
      charIndex.current = 0;
      setDisplayText("");
      setIsTalking(true);
      setBubbleVisible(true);
      typeTimer.current = setTimeout(typeNext, 200);

      // Keep talking gif playing for its full duration regardless of text
      talkTimer.current = setTimeout(() => {
        setIsTalking(false);
      }, TALKING_GIF_DURATION);
    }, 1500);

    return () => {
      clearTimeout(startDelay);
      clearTimers();
    };
  }, [typeNext, clearTimers]);

  return (
    <>
      <div className="page-header">
        <h2>Simulation</h2>
        <p>
          Test routing and email configurations without sending SMS, emails, or
          writing to the database.
        </p>
      </div>

      {/* Otocon character */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          marginBottom: 24,
        }}
      >
        <div style={{ position: "relative", display: "inline-flex", alignItems: "center" }}>
          {bubbleVisible && (
            <div className="speech-bubble" style={{ whiteSpace: "normal" }}>
              <span className="speech-bubble-text">{displayText}</span>
              <span className="speech-bubble-cursor">_</span>
            </div>
          )}
          <img
            key={isTalking ? "talking" : "standing"}
            src={isTalking ? "/otocon-talking.gif" : "/otocon-standing.gif"}
            alt="Otocon"
            style={{
              width: 164,
              height: 164,
              imageRendering: "pixelated",
              objectFit: "contain",
            }}
          />
        </div>
      </div>

      <div className="grid-2">
        <button
          className="card"
          onClick={() => router.push("/dashboard/simulate")}
          style={{
            cursor: "pointer",
            textAlign: "left",
            transition: "border-color 0.15s, background 0.15s",
            border: "1px solid var(--border)",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.borderColor = "var(--accent)";
            e.currentTarget.style.background = "var(--bg-card-hover)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = "var(--border)";
            e.currentTarget.style.background = "var(--bg-card)";
          }}
        >
          <div className="sim-icon-glow" style={{ fontSize: 36, marginBottom: 12 }}>{"\u2630"}</div>
          <h3
            style={{
              fontSize: 16,
              fontWeight: 700,
              color: "var(--text-heading)",
              marginBottom: 6,
            }}
          >
            Simulate Form Submission
          </h3>
          <p className="text-muted" style={{ fontSize: 13 }}>
            Test lead routing with single, bulk, or 30-day simulations using
            your current agent configuration.
          </p>
        </button>

        <button
          className="card"
          onClick={() => router.push("/dashboard/email-hub/simulate")}
          style={{
            cursor: "pointer",
            textAlign: "left",
            transition: "border-color 0.15s, background 0.15s",
            border: "1px solid var(--border)",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.borderColor = "var(--accent)";
            e.currentTarget.style.background = "var(--bg-card-hover)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = "var(--border)";
            e.currentTarget.style.background = "var(--bg-card)";
          }}
        >
          <div className="sim-icon-glow" style={{ fontSize: 36, marginBottom: 12 }}>{"\u2709"}</div>
          <h3
            style={{
              fontSize: 16,
              fontWeight: 700,
              color: "var(--text-heading)",
              marginBottom: 6,
            }}
          >
            Simulate Email
          </h3>
          <p className="text-muted" style={{ fontSize: 13 }}>
            Test AI-generated email responses by composing a mock inbound email
            and reviewing the draft.
          </p>
        </button>
      </div>
    </>
  );
}
