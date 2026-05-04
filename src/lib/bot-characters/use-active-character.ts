"use client";

import { useEffect, useState } from "react";
import {
  ensureScheduleLoaded,
  getActiveCharacter,
  subscribeToSchedule,
  type BotCharacter,
} from "./index";

/**
 * React hook: returns the currently-active bot character. On first mount
 * triggers a one-time load of the schedule from /api/internal/settings;
 * subscribes to in-process schedule changes (e.g. after the editor saves)
 * so the component re-renders without a page refresh.
 */
export function useActiveCharacter(): BotCharacter {
  const [character, setCharacter] = useState<BotCharacter>(() => getActiveCharacter());

  useEffect(() => {
    let cancelled = false;
    const sync = () => {
      if (!cancelled) setCharacter(getActiveCharacter());
    };
    ensureScheduleLoaded().then(sync);
    const unsub = subscribeToSchedule(sync);
    return () => {
      cancelled = true;
      unsub();
    };
  }, []);

  return character;
}
