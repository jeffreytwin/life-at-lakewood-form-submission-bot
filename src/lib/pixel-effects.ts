/**
 * Pixel-art effects over the dashboard for the moments worth a little show
 * (Jeff, 2026-09-29): bursts of square pixels on one shared canvas, in the
 * same blocky style as the fireworks, a rubber stamp, and a picture flying
 * into the character in the corner. Each is fire-and-forget: it lies over
 * the page in fixed position, so no list scrolls or shifts under it,
 * ignores the pointer, and cleans up after itself. With reduced motion
 * asked for, none of them play. Browser only; call from event handlers.
 */

/** The grid pixels snap to, as the fireworks draw them. */
const PX = 4;
/** Motion is timed against 60 frames a second, so a faster screen plays at the same pace. */
const FRAME_MS = 1000 / 60;

export interface BurstSpec {
  count: number;
  colors: string[];
  /** Launch speed range, px per frame. */
  speed: [number, number];
  /** Lifetime range, in frames. */
  life: [number, number];
  /** Pull each frame; negative drifts up, like smoke. */
  gravity: number;
  /** Share of its speed a pixel keeps each frame; 1 keeps it all. */
  drag?: number;
  /** Added to every pixel's launch speed upward (negative is up). */
  lift?: number;
  /** Pixel size, a multiple of the grid. */
  size?: number;
  /** Launch points spread this many px either side, for a burst the width of a row. */
  spreadX?: number;
}

interface Bit {
  x: number;
  y: number;
  vx: number;
  vy: number;
  gravity: number;
  drag: number;
  color: string;
  life: number;
  maxLife: number;
  size: number;
}

let canvas: HTMLCanvasElement | null = null;
let bits: Bit[] = [];
let frame: number | null = null;
let lastTime = 0;

export function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/** The shared canvas, made on first use and kept the size of the window. */
function surface(): CanvasRenderingContext2D | null {
  if (!canvas || !canvas.isConnected) {
    canvas = document.createElement("canvas");
    canvas.className = "pixel-effects-canvas";
    canvas.setAttribute("aria-hidden", "true");
    document.body.appendChild(canvas);
  }
  if (canvas.width !== window.innerWidth || canvas.height !== window.innerHeight) {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  }
  return canvas.getContext("2d");
}

const within = ([lo, hi]: [number, number]) => lo + Math.random() * (hi - lo);

/** Throws a burst of pixels from a point on screen. */
export function pixelBurst(x: number, y: number, spec: BurstSpec): void {
  if (typeof window === "undefined" || prefersReducedMotion() || !surface()) return;
  for (let i = 0; i < spec.count; i++) {
    const angle = (Math.PI * 2 * i) / spec.count + (Math.random() - 0.5) * 0.6;
    const speed = within(spec.speed);
    const life = within(spec.life);
    bits.push({
      x: x + (spec.spreadX ? (Math.random() * 2 - 1) * spec.spreadX : 0),
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed + (spec.lift ?? 0),
      gravity: spec.gravity,
      drag: spec.drag ?? 1,
      color: spec.colors[Math.floor(Math.random() * spec.colors.length)],
      life,
      maxLife: life,
      size: spec.size ?? PX,
    });
  }
  if (frame === null) frame = requestAnimationFrame(draw);
}

function draw(now: number) {
  const ctx = surface();
  if (!ctx || !canvas) {
    bits = [];
    frame = null;
    return;
  }
  const step = lastTime ? Math.min((now - lastTime) / FRAME_MS, 3) : 1;
  lastTime = now;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const alive: Bit[] = [];
  for (const b of bits) {
    b.life -= step;
    if (b.life <= 0) continue;
    const keep = Math.pow(b.drag, step);
    b.vx *= keep;
    b.vy = b.vy * keep + b.gravity * step;
    b.x += b.vx * step;
    b.y += b.vy * step;
    ctx.globalAlpha = b.life / b.maxLife;
    ctx.fillStyle = b.color;
    ctx.fillRect(Math.round(b.x / PX) * PX, Math.round(b.y / PX) * PX, b.size, b.size);
    alive.push(b);
  }
  ctx.globalAlpha = 1;
  bits = alive;
  if (bits.length) {
    frame = requestAnimationFrame(draw);
  } else {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    frame = null;
    lastTime = 0;
  }
}

/** Plays a Web Animation on an element made for it, and takes the element away when it ends. */
function playOnce(el: HTMLElement, frames: Keyframe[], options: KeyframeAnimationOptions, then?: () => void) {
  document.body.appendChild(el);
  el.animate(frames, options).finished.then(
    () => {
      el.remove();
      then?.();
    },
    () => el.remove()
  );
}

/** A rubber stamp slammed down at a point on screen, which then fades. */
export function stamp(label: string, color: string, x: number, y: number, tilt: number, duration: number): void {
  if (prefersReducedMotion()) return;
  const el = document.createElement("div");
  el.className = "pixel-stamp";
  el.textContent = label;
  el.setAttribute("aria-hidden", "true");
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
  el.style.color = color;
  const at = (scale: number) => `translate(-50%, -50%) rotate(${tilt}deg) scale(${scale})`;
  playOnce(
    el,
    [
      { opacity: 0, transform: at(2.6) },
      { opacity: 1, transform: at(0.9), offset: 0.16 },
      { opacity: 1, transform: at(1), offset: 0.24 },
      { opacity: 1, transform: at(1), offset: 0.78 },
      { opacity: 0, transform: at(1.04) },
    ],
    { duration, easing: "ease-out", fill: "forwards" }
  );
}

/**
 * A copy of a picture lifts off and flies into a target, which bobs as it
 * lands: on Floor Plans, an approved plan collected by the character.
 */
export function flyInto(img: HTMLImageElement, target: HTMLElement, duration = 650): void {
  if (prefersReducedMotion()) return;
  const from = img.getBoundingClientRect();
  const to = target.getBoundingClientRect();
  if (!from.width || !to.width) return;
  const ghost = img.cloneNode(false) as HTMLImageElement;
  ghost.removeAttribute("style");
  ghost.className = "pixel-fly";
  ghost.alt = "";
  ghost.setAttribute("aria-hidden", "true");
  ghost.style.left = `${from.left}px`;
  ghost.style.top = `${from.top}px`;
  ghost.style.width = `${from.width}px`;
  ghost.style.height = `${from.height}px`;
  const dx = to.left + to.width / 2 - (from.left + from.width / 2);
  const dy = to.top + to.height / 2 - (from.top + from.height / 2);
  playOnce(
    ghost,
    [
      { transform: "translate(0px, 0px) scale(1) rotate(0deg)", opacity: 1 },
      { transform: `translate(${dx * 0.3}px, ${dy * 0.3 - 90}px) scale(0.8) rotate(-10deg)`, opacity: 1, offset: 0.4 },
      { transform: `translate(${dx}px, ${dy}px) scale(0.16) rotate(14deg)`, opacity: 0.25 },
    ],
    { duration, easing: "cubic-bezier(0.5, 0, 0.75, 0.3)", fill: "forwards" },
    () => {
      // `scale` rather than `transform`, so the bob stacks on the sprite's own nudge.
      target.animate([{ scale: "1" }, { scale: "1.18" }, { scale: "0.96" }, { scale: "1" }], { duration: 320, easing: "ease-out" });
    }
  );
}

/** A short jolt, as of something going off nearby. */
export function shake(el: HTMLElement, strength = 3): void {
  if (prefersReducedMotion()) return;
  const s = strength;
  el.animate(
    [
      { transform: "translate(0px, 0px)" },
      { transform: `translate(${-s}px, ${s / 2}px)` },
      { transform: `translate(${s}px, ${-s / 2}px)` },
      { transform: `translate(${-s / 2}px, 0px)` },
      { transform: "translate(0px, 0px)" },
    ],
    { duration: 280, easing: "ease-out" }
  );
}
