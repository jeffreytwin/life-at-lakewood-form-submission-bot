/**
 * Which sound plays for what, in one place. The dashboard plays these from
 * three places (the lead status monitor, the listings alert monitor, and
 * the leads page when the person acts on a lead by hand), and they drifted
 * apart when each kept its own copy.
 *
 * Jeff, 2026-09-16: the alert is the "a person is needed" sound. A lead
 * that falls to manual needs someone to pick it up, so it gets the alert;
 * bad data needs nothing from anyone, so it takes the quieter manual tone.
 */

export const SOUNDS = {
  /** A person is needed: a lead fell to manual, routing failed, listings hit a problem. */
  alert: "/sounds/metal-gear-alert.mp3",
  /** Noted, nothing to do: bad data flagged. */
  manual: "/sounds/mgs - manual.mp3",
  victory: "/sounds/metal-gear-victory.mp3",
  codec: "/sounds/mgs-codec.mp3",
  newForm: "/sounds/mgs-new-form.mp3",
} as const;

/** The sound each lead routing status plays when a lead lands on it. */
export const STATUS_SOUNDS: Record<string, string> = {
  accepted: SOUNDS.victory,
  routing: SOUNDS.codec,
  failed: SOUNDS.alert,
  manual: SOUNDS.alert,
  owned_by_other: SOUNDS.victory,
  bad_data: SOUNDS.manual,
};

export const NEW_LEAD_SOUND = SOUNDS.newForm;
/** A new error in the listings engine: the Hub only records ones a person has to act on. */
export const LISTINGS_ALERT_SOUND = SOUNDS.alert;

// Browsers refuse to play audio before the page has had a user gesture.
// The first blocked sound is held and played once the person clicks or
// types anywhere, so an alert that fires on a freshly opened tab is not
// lost silently.
let audioUnlocked = false;
let pendingSound: string | null = null;

function unlockAudio() {
  if (audioUnlocked) return;
  audioUnlocked = true;
  if (pendingSound) {
    const src = pendingSound;
    pendingSound = null;
    playSound(src);
  }
  document.removeEventListener("click", unlockAudio, true);
  document.removeEventListener("keydown", unlockAudio, true);
}

if (typeof document !== "undefined") {
  document.addEventListener("click", unlockAudio, true);
  document.addEventListener("keydown", unlockAudio, true);
}

export function playSound(src: string, volume = 0.6) {
  const audio = new Audio(src);
  audio.volume = volume;
  audio.play().catch(() => {
    if (!audioUnlocked) pendingSound = src;
  });
}
