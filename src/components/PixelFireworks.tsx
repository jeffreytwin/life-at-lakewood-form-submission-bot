"use client";

import { useEffect, useRef } from "react";
import { onLeadEvent } from "@/lib/lead-events";
import { currentHoliday } from "@/lib/bot-characters";
import { HOLIDAY_FALLS, PX, drawPieces, fireworkColors, makePieces, type Fall } from "@/lib/holiday-celebration";

/** The fall is cut off here even if a slow piece is still on its way down. */
const FALL_DURATION = 12000; // ms
const FALL_FADE = 1000; // ms
/** Motion is timed against 60 frames a second, so a faster screen plays at the same pace. */
const FRAME_MS = 1000 / 60;
const PARTICLE_COUNT = 120;
const ROCKET_COUNT = 10;
const ROUND_1_DURATION = 3000; // ms before second round
const DURATION = 6500; // total ms

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  color: string;
  life: number;
  maxLife: number;
}

interface Rocket {
  x: number;
  targetY: number;
  y: number;
  speed: number;
  exploded: boolean;
  particles: Particle[];
  color: string;
}

function pick(colors: string[]) {
  return colors[Math.floor(Math.random() * colors.length)];
}

function createRocket(w: number, h: number, colors: string[]): Rocket {
  return {
    x: Math.random() * w * 0.6 + w * 0.2,
    targetY: Math.random() * h * 0.3 + h * 0.1,
    y: h,
    speed: 4 + Math.random() * 3,
    exploded: false,
    particles: [],
    color: pick(colors),
  };
}

function explodeRocket(rocket: Rocket, colors: string[]) {
  const baseColor = rocket.color;
  const accent = pick(colors);
  for (let i = 0; i < PARTICLE_COUNT; i++) {
    const angle = (Math.PI * 2 * i) / PARTICLE_COUNT + (Math.random() - 0.5) * 0.3;
    const speed = 1.5 + Math.random() * 3;
    const life = 40 + Math.random() * 40;
    rocket.particles.push({
      x: rocket.x,
      y: rocket.y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      color: Math.random() > 0.3 ? baseColor : accent,
      life,
      maxLife: life,
    });
  }
  rocket.exploded = true;
}

/**
 * The show over the whole dashboard when something is worth celebrating:
 * fireworks on an ordinary day, and the holiday's own celebration while a
 * hat is on (see holiday-celebration.ts).
 */
export default function PixelFireworks() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animRef = useRef<number | null>(null);

  function startFall(fall: Fall) {
    if (animRef.current) cancelAnimationFrame(animRef.current);

    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    canvas.style.display = "block";
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const pieces = makePieces(fall, canvas.width, canvas.height);
    const start = performance.now();
    let last = start;

    function draw(now: number) {
      if (!ctx || !canvas) return;
      const step = Math.min((now - last) / FRAME_MS, 3);
      last = now;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      // Whatever is still falling at the end fades out, not blinks out.
      ctx.globalAlpha = Math.min(1, (FALL_DURATION - (now - start)) / FALL_FADE);
      const anyLeft = drawPieces(ctx, pieces, step, canvas.height);
      ctx.globalAlpha = 1;
      if (anyLeft && now - start < FALL_DURATION) {
        animRef.current = requestAnimationFrame(draw);
      } else {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        canvas.style.display = "none";
        animRef.current = null;
      }
    }

    animRef.current = requestAnimationFrame(draw);
  }

  function startFireworks(colors: string[]) {
    // Cancel any running animation
    if (animRef.current) cancelAnimationFrame(animRef.current);

    const canvas = canvasRef.current;
    if (!canvas) return;

    const w = window.innerWidth;
    const h = window.innerHeight;
    canvas.width = w;
    canvas.height = h;
    canvas.style.display = "block";

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const rockets: Rocket[] = [];
    for (let i = 0; i < ROCKET_COUNT; i++) {
      const r = createRocket(w, h, colors);
      // Stagger launches
      r.y = h + i * 40;
      rockets.push(r);
    }

    const start = performance.now();
    let round2Launched = false;

    function draw(now: number) {
      const elapsed = now - start;
      if (!ctx || !canvas) return;

      // Launch second round of rockets
      if (!round2Launched && elapsed >= ROUND_1_DURATION) {
        round2Launched = true;
        for (let i = 0; i < ROCKET_COUNT; i++) {
          const r = createRocket(w, h, colors);
          r.y = h + i * 40;
          rockets.push(r);
        }
      }

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      let anyAlive = false;

      for (const rocket of rockets) {
        if (!rocket.exploded) {
          // Move rocket up
          rocket.y -= rocket.speed;

          // Draw rocket trail (pixelated)
          ctx.fillStyle = rocket.color;
          const rx = Math.round(rocket.x / PX) * PX;
          const ry = Math.round(rocket.y / PX) * PX;
          ctx.fillRect(rx, ry, PX, PX);
          // Trail
          ctx.fillStyle = "#fff1e8";
          ctx.fillRect(rx, ry + PX, PX, PX);
          ctx.fillRect(rx, ry + PX * 2, PX, PX);

          if (rocket.y <= rocket.targetY) {
            explodeRocket(rocket, colors);
          }
          anyAlive = true;
        }

        // Draw particles
        for (const p of rocket.particles) {
          if (p.life <= 0) continue;
          anyAlive = true;

          p.x += p.vx;
          p.y += p.vy;
          p.vy += 0.06; // gravity
          p.vx *= 0.99;
          p.life--;

          const alpha = p.life / p.maxLife;
          ctx.globalAlpha = alpha;
          ctx.fillStyle = p.color;
          const px = Math.round(p.x / PX) * PX;
          const py = Math.round(p.y / PX) * PX;
          ctx.fillRect(px, py, PX, PX);
        }
      }
      ctx.globalAlpha = 1;

      if (anyAlive && elapsed < DURATION) {
        animRef.current = requestAnimationFrame(draw);
      } else {
        // Clean up
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        canvas.style.display = "none";
        animRef.current = null;
      }
    }

    animRef.current = requestAnimationFrame(draw);
  }

  useEffect(() => {
    return onLeadEvent((event) => {
      if (event.type !== "accepted" && event.type !== "owned_by_other" && event.type !== "done" && event.type !== "email_sent" && event.type !== "floorplans_cleared" && event.type !== "community_sold_out_done" && event.type !== "community_new_neighborhood_done" && event.type !== "community_schools_done" && event.type !== "community_fee_check_done" && event.type !== "war_room_task_done") return;
      // Read when the event arrives, so the hat that is on now decides.
      const holiday = currentHoliday();
      const fall = holiday ? HOLIDAY_FALLS[holiday] : undefined;
      if (fall) startFall(fall);
      else startFireworks(fireworkColors(holiday));
    });
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        width: "100vw",
        height: "100vh",
        pointerEvents: "none",
        zIndex: 9999,
        display: "none",
      }}
    />
  );
}
