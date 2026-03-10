"use client";

import { useEffect, useRef } from "react";
import { onLeadEvent } from "@/lib/lead-events";

/** Pixel size for the retro blocky look */
const PX = 4;
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

const COLORS = [
  "#ff004d", // red
  "#ff77a8", // pink
  "#ffccaa", // peach
  "#ffa300", // orange
  "#ffec27", // yellow
  "#00e436", // green
  "#29adff", // blue
  "#83769c", // lavender
  "#fff1e8", // white
];

function randomColor() {
  return COLORS[Math.floor(Math.random() * COLORS.length)];
}

function createRocket(w: number, h: number): Rocket {
  return {
    x: Math.random() * w * 0.6 + w * 0.2,
    targetY: Math.random() * h * 0.3 + h * 0.1,
    y: h,
    speed: 4 + Math.random() * 3,
    exploded: false,
    particles: [],
    color: randomColor(),
  };
}

function explodeRocket(rocket: Rocket) {
  const baseColor = rocket.color;
  const accent = randomColor();
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

export default function PixelFireworks() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animRef = useRef<number | null>(null);

  useEffect(() => {
    return onLeadEvent((event) => {
      if (event.type !== "accepted" && event.type !== "owned_by_other" && event.type !== "done") return;
      startFireworks();
    });
  }, []);

  function startFireworks() {
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
      const r = createRocket(w, h);
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
          const r = createRocket(w, h);
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
            explodeRocket(rocket);
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
