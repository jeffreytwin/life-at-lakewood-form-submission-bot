import { flyInto, pixelBurst, prefersReducedMotion, shake, stamp, type BurstSpec } from "@/lib/pixel-effects";
import type { Exit } from "@/lib/floorplans/leaving-rows";

// What plays over a plan's row as it leaves the queue (Jeff, 2026-09-29),
// alongside the row's own animation in globals.css (fp-leaving-*):
//   Approve: an APPROVED stamp over the buttons, green sparks, and the
//            plan's picture flies into the character, who collects it.
//   Reject:  a REJECTED stamp, and the row's pieces fall away.
//   Remove:  the row blinks like a charge about to blow, then goes up in a
//            pixel explosion that jolts the list. It takes the plan off the
//            live site, so it gets the biggest bang.
// A plan that leaves any other way ("leave") only fades, in CSS.

const APPROVED = "#34d399";
const REJECTED = "#f87171";

const SPARKS: BurstSpec = {
  count: 36,
  colors: ["#34d399", "#6ee7b7", "#a7f3d0", "#fde68a", "#fff1e8"],
  speed: [1.4, 4.2],
  life: [26, 48],
  gravity: 0.07,
  drag: 0.97,
  lift: -1.2,
};

const DEBRIS: BurstSpec = {
  count: 34,
  colors: ["#f87171", "#dc2626", "#8b8fa3", "#4b5563", "#2a2e3a"],
  speed: [0.4, 1.8],
  life: [34, 60],
  gravity: 0.24,
  drag: 0.99,
  lift: -1.2,
};

const BLAST: BurstSpec = {
  count: 70,
  colors: ["#fff1e8", "#ffec27", "#ffa300", "#fb923c", "#ff004d"],
  speed: [2, 7.5],
  life: [22, 50],
  gravity: 0.09,
  drag: 0.955,
};

const SMOKE: BurstSpec = {
  count: 14,
  colors: ["#6b7280", "#8b8fa3", "#4b5563"],
  speed: [0.3, 1.2],
  life: [50, 85],
  gravity: -0.015,
  drag: 0.985,
  lift: -0.8,
  size: 8,
};

/** Where on screen an effect lands, kept to the part of the table in view: on a phone the table scrolls sideways. */
function spot(el: Element, row: HTMLTableRowElement): { x: number; y: number; left: number; right: number } {
  const r = el.getBoundingClientRect();
  const view = (row.closest(".table-wrapper") ?? document.documentElement).getBoundingClientRect();
  const left = Math.max(view.left, 0);
  const right = Math.min(view.right, window.innerWidth);
  // A stamp's middle stays this far inside, so the whole stamp shows.
  const margin = Math.min(70, (right - left) / 2);
  const x = Math.min(Math.max((r.left + r.right) / 2, left + margin), right - margin);
  return { x, y: (r.top + r.bottom) / 2, left: Math.max(r.left, left), right: Math.min(r.right, right) };
}

export interface ExitPlay {
  exit: Exit;
  /** Before it starts, for a batch going out as a wave. */
  delay: number;
  /** The row's own animation, before it folds away. */
  duration: number;
  /** How long the stamp stays: the row's animation and its fold. */
  stampFor: number;
  /** Whether this row throws pixels: the first few of a batch do, not a page of fifty. */
  particles: boolean;
  /** The first of a batch: its blast is the one that jolts the list. */
  lead: boolean;
}

/** Plays a plan's way out over its row, found when the moment comes in case the list has moved. */
export function playExit(rowOf: () => HTMLTableRowElement | undefined, play: ExitPlay): void {
  if (play.exit === "leave" || prefersReducedMotion()) return;
  const later = (ms: number, fn: () => void) => window.setTimeout(fn, ms);

  if (play.exit === "remove") {
    // The blast lands as the row's blinking gives way to its flash (fpRowRemove, halfway).
    later(play.delay + play.duration * 0.5, () => {
      const row = rowOf();
      if (!row) return;
      const at = spot(row, row);
      if (play.particles) {
        [0.2, 0.5, 0.8].forEach((f, i) =>
          later(i * 70, () => {
            const x = at.left + (at.right - at.left) * f;
            pixelBurst(x, at.y, BLAST);
            pixelBurst(x, at.y, SMOKE);
          })
        );
      }
      const card = row.closest<HTMLElement>(".card");
      if (play.lead && card) shake(card);
    });
    return;
  }

  const approve = play.exit === "approve";
  later(play.delay, () => {
    const row = rowOf();
    if (!row) return;
    const at = spot(row.lastElementChild ?? row, row);
    stamp(approve ? "Approved" : "Rejected", approve ? APPROVED : REJECTED, at.x, at.y, approve ? -8 : 7, play.stampFor);
    if (play.particles) {
      later(110, () => {
        if (approve) {
          pixelBurst(at.x, at.y, SPARKS);
          return;
        }
        const across = spot(row, row);
        pixelBurst((across.left + across.right) / 2, across.y, { ...DEBRIS, spreadX: (across.right - across.left) / 2 });
      });
    }
    if (!approve) return;
    later(260, () => {
      const picture = row.querySelector<HTMLImageElement>("td:nth-child(2) img");
      const character = document.querySelector<HTMLElement>(".routing-character img");
      if (picture && character) flyInto(picture, character);
    });
  });
}
