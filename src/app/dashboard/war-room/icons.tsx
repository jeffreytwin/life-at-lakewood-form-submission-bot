/** Line icons for the War Room, drawn in currentColor. */

import type { BriefingTone } from "@/lib/war-room/metrics";
import type { GoalMetric } from "@/lib/war-room/metrics";

const base = {
  width: 28,
  height: 28,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

export function TargetIcon({ size = 22 }: { size?: number }) {
  return (
    <svg {...base} width={size} height={size}>
      <circle cx="11" cy="13" r="8" />
      <circle cx="11" cy="13" r="4.5" />
      <circle cx="11" cy="13" r="1.2" fill="currentColor" />
      <path d="M11 13 20 4M16.5 4H20v3.5" />
    </svg>
  );
}

export function ChecklistIcon({ size = 22 }: { size?: number }) {
  return (
    <svg {...base} width={size} height={size}>
      <rect x="3.5" y="3.5" width="17" height="17" rx="2" />
      <path d="m8 12 3 3 5-6" />
    </svg>
  );
}

export function SignalIcon({ size = 22 }: { size?: number }) {
  return (
    <svg {...base} width={size} height={size}>
      <circle cx="12" cy="11" r="1.6" fill="currentColor" />
      <path d="M12 12.6V21M8.5 7.5a5 5 0 0 0 0 7M15.5 7.5a5 5 0 0 1 0 7M5.6 4.6a9 9 0 0 0 0 12.8M18.4 4.6a9 9 0 0 1 0 12.8" />
    </svg>
  );
}

export function GoalIcon({ metric }: { metric: GoalMetric }) {
  switch (metric) {
    case "transactions": // a signed contract
      return (
        <svg {...base}>
          <path d="M6 3.5h8l4 4v13H6z" />
          <path d="M14 3.5v4h4M9 12h6M9 15.5h3" />
          <path d="m12.5 19 1.5-1.5 1.5 1.5 2-2.5" />
        </svg>
      );
    case "pre_split": // stacked coins
      return (
        <svg {...base}>
          <ellipse cx="12" cy="6" rx="6.5" ry="2.5" />
          <path d="M5.5 6v4c0 1.4 2.9 2.5 6.5 2.5s6.5-1.1 6.5-2.5V6" />
          <path d="M5.5 10v4c0 1.4 2.9 2.5 6.5 2.5s6.5-1.1 6.5-2.5v-4" />
          <path d="M5.5 14v4c0 1.4 2.9 2.5 6.5 2.5s6.5-1.1 6.5-2.5v-4" />
        </svg>
      );
    case "post_split": // rising bars
      return (
        <svg {...base}>
          <path d="M4 20.5h16" />
          <rect x="5" y="13" width="3" height="7.5" />
          <rect x="10.5" y="9" width="3" height="11.5" />
          <rect x="16" y="4.5" width="3" height="16" />
        </svg>
      );
    case "profit": // trophy
      return (
        <svg {...base}>
          <path d="M7.5 3.5h9v5a4.5 4.5 0 0 1-9 0z" />
          <path d="M7.5 5.5H4.5v1.5a3 3 0 0 0 3 3M16.5 5.5h3v1.5a3 3 0 0 1-3 3" />
          <path d="M12 13v3.5M8.5 20.5h7M9.5 20.5l.5-4h4l.5 4" />
        </svg>
      );
  }
}

/** The Mission Briefing's status marks: filled, like the art's. */
export function ToneIcon({ tone }: { tone: BriefingTone }) {
  const s = { width: "1.25em", height: "1.25em", viewBox: "0 0 24 24", "aria-hidden": true };
  switch (tone) {
    case "ok":
      return (
        <svg {...s}>
          <circle cx="12" cy="12" r="10" fill="#22d37a" />
          <path d="m7.5 12.5 3 3 6-6.5" fill="none" stroke="#04241a" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case "warn":
      return (
        <svg {...s}>
          <path d="M12 2.5 23 21.5H1z" fill="#fbbf24" />
          <path d="M12 9.5v5.5" stroke="#2a1d00" strokeWidth="2.4" strokeLinecap="round" />
          <circle cx="12" cy="18.2" r="1.3" fill="#2a1d00" />
        </svg>
      );
    case "danger":
      return (
        <svg {...s}>
          <circle cx="12" cy="12" r="10" fill="#f87171" />
          <path d="M12 6.5v7" stroke="#2b0707" strokeWidth="2.6" strokeLinecap="round" />
          <circle cx="12" cy="17.2" r="1.4" fill="#2b0707" />
        </svg>
      );
    case "next":
      return (
        <svg {...s}>
          <circle cx="12" cy="12" r="9" fill="none" stroke="#22d37a" strokeWidth="2.4" />
          <path d="M12 7v5.5l3.5 2" fill="none" stroke="#22d37a" strokeWidth="2.4" strokeLinecap="round" />
        </svg>
      );
  }
}
