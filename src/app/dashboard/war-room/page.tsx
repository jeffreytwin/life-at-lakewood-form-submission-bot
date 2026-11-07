"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  buildBriefing,
  goalProgress,
  monthsInPeriod,
  periodTotals,
  yearElapsed,
  type BriefingLine,
  type GoalTarget,
  type StatusPeriod,
} from "@/lib/war-room/metrics";
import type { MonthMetrics } from "@/lib/war-room/sample-metrics";
import type { WarRoomTask } from "@/lib/war-room/store";
import { GoalsCard, StatusCard, TasksCard } from "./cards";
import { ToneIcon } from "./icons";

/**
 * War Room (Jeff, 2026-11-07): the year's big goals and whether they're on
 * pace, a to-do list, and the month's contracts, revenue and ad spend.
 * Revenue numbers are sample figures until the Salesforce and ad-spend
 * Zaps are connected; goals and tasks are real and saved.
 */

interface Summary {
  year: number;
  goals: GoalTarget[];
  months: MonthMetrics[];
  sample: boolean;
  leadsToday: number | null;
}

const BANNER_KEY = "war-room-banner-hidden";

export default function WarRoomPage() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [tasks, setTasks] = useState<WarRoomTask[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [period, setPeriod] = useState<StatusPeriod>("month");
  const [bannerHidden, setBannerHidden] = useState(false);
  const [now, setNow] = useState(() => new Date());

  const loadSummary = useCallback(async () => {
    try {
      const r = await fetch("/api/internal/war-room");
      const data = await r.json();
      if (!r.ok) throw new Error(data?.error ?? `HTTP ${r.status}`);
      setSummary(data);
      setNow(new Date());
      setError(null);
    } catch (e) {
      setError(`Couldn't load the War Room: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, []);

  const loadTasks = useCallback(async () => {
    try {
      const r = await fetch("/api/internal/war-room/tasks");
      const data = await r.json();
      if (!r.ok) throw new Error(data?.error ?? `HTTP ${r.status}`);
      setTasks(data);
    } catch (e) {
      setError(`Couldn't load tasks: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, []);

  useEffect(() => {
    loadSummary();
    loadTasks();
    // Today's form submissions keep counting while the page is open.
    const interval = setInterval(loadSummary, 60_000);
    return () => clearInterval(interval);
  }, [loadSummary, loadTasks]);

  useEffect(() => {
    try {
      setBannerHidden(localStorage.getItem(BANNER_KEY) === "1");
    } catch {
      /* private window: the banner shows */
    }
  }, []);

  function toggleBanner() {
    const next = !bannerHidden;
    setBannerHidden(next);
    try {
      localStorage.setItem(BANNER_KEY, next ? "1" : "0");
    } catch {
      /* not remembered, still toggled */
    }
  }

  const goals = useMemo(
    () => (summary ? goalProgress(summary.goals, summary.months, yearElapsed(summary.year, now)) : []),
    [summary, now],
  );

  const totals = useMemo(
    () => (summary ? periodTotals(monthsInPeriod(summary.months, period, now)) : null),
    [summary, period, now],
  );

  const briefing = useMemo<BriefingLine[]>(() => {
    if (!summary) return [];
    return buildBriefing({
      goals,
      leadsToday: summary.leadsToday,
      tasks: (tasks ?? []).map((t) => ({ title: t.title, dueDate: t.dueDate, done: t.doneAt !== null })),
      now,
    });
  }, [summary, goals, tasks, now]);

  const briefingList = (
    <ul className="wr-briefing-list">
      {briefing.map((line, i) => (
        <li key={i} className={`wr-tone-${line.tone}`}>
          <ToneIcon tone={line.tone} />
          <span title={line.text}>{line.text}</span>
        </li>
      ))}
    </ul>
  );

  return (
    <div className="wr">
      {bannerHidden ? (
        <header className="wr-header-slim">
          <div className="wr-title">
            <h2>
              <span className="wr-bracket">[</span>WAR ROOM<span className="wr-bracket">]</span>
            </h2>
            <p>STRATEGY / GOALS / EXECUTION</p>
          </div>
          <div className="wr-header-actions">
            <span className="wr-op-active">
              <span className="wr-op-dot" /> OPERATION ACTIVE
            </span>
            <button className="wr-banner-toggle" onClick={toggleBanner}>
              Show art
            </button>
          </div>
        </header>
      ) : (
        <section className="wr-banner" aria-label="War Room">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/war-room/war-room-banner.webp"
            alt="The team around a map table of Lakewood Ranch, Wellen Park and Parrish"
            width={1920}
            height={780}
          />
          <div className="wr-title wr-title-over">
            <h2>
              <span className="wr-bracket">[</span>WAR ROOM<span className="wr-bracket">]</span>
            </h2>
            <p>STRATEGY / GOALS / EXECUTION</p>
          </div>
          <div className="wr-banner-corner">
            <span className="wr-op-active">
              <span className="wr-op-dot" /> OPERATION ACTIVE
            </span>
            <button className="wr-banner-toggle" onClick={toggleBanner}>
              Hide art
            </button>
          </div>
          {/* Written onto the art's own briefing screen; below the banner on narrow screens. */}
          <div className="wr-briefing-over" aria-live="polite">
            {briefingList}
          </div>
        </section>
      )}

      <div className={`card wr-briefing-card${bannerHidden ? " wr-briefing-card-always" : ""}`}>
        <div className="wr-card-title">Mission Briefing</div>
        {briefingList}
      </div>

      {error && <div className="wr-error">{error}</div>}

      <div className="wr-grid">
        <GoalsCard year={summary?.year ?? now.getFullYear()} goals={goals} targets={summary?.goals ?? []} sample={summary?.sample ?? true} loading={!summary} onSaved={loadSummary} />
        <TasksCard tasks={tasks} now={now} onChange={loadTasks} />
        <StatusCard totals={totals} period={period} onPeriod={setPeriod} sample={summary?.sample ?? true} />
      </div>
    </div>
  );
}
