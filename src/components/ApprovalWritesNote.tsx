"use client";

// The approved floor plans the server is still writing to Wix, said under
// every page's title until there are none (Jeff, 2026-10-10: "I'd like for
// that kind of message to appear under every page title so it's persistent
// until all plans are approved"). The writes run on the server whether or
// not any page is open (approvals.ts); this only says how many are left.
//
// Every page draws its own title block (`.page-header`), so the note is put
// in a place of its own just after whichever one is showing, and moves
// with it from page to page.

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { FLOORPLAN_WRITES_EVENT } from "@/lib/floorplans/writes-event";

/** How often the count is read while plans are being written, and while none are. */
const WRITING_MS = 5_000;
const IDLE_MS = 30_000;

export default function ApprovalWritesNote() {
  const [writing, setWriting] = useState(0);
  // The note's own place in the page, made once; put after the title below.
  const [slot] = useState<HTMLElement | null>(() => {
    if (typeof document === "undefined") return null;
    const place = document.createElement("div");
    place.className = "approval-writes-slot";
    return place;
  });

  // The count, read more often while there is one.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;
    // Only the latest read sets the next one, so a read asked for while
    // another is on its way never leaves two of them going.
    let latest = 0;
    const read = () => {
      if (timer) clearTimeout(timer);
      const mine = ++latest;
      fetch("/api/internal/floorplans/changes?count=writing")
        .then((r) => r.json())
        .then((data) => (typeof data?.plans === "number" ? (data.plans as number) : null))
        .catch(() => null)
        .then((n) => {
          if (stopped || mine !== latest) return;
          if (n !== null) setWriting(n);
          timer = setTimeout(read, n ? WRITING_MS : IDLE_MS);
        });
    };
    read();
    // Plans just approved on the Floor Plans page: said at once, not at the next read.
    window.addEventListener(FLOORPLAN_WRITES_EVENT, read);
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      window.removeEventListener(FLOORPLAN_WRITES_EVENT, read);
    };
  }, []);

  // A place just after the page's title block, kept there as pages change.
  const showing = writing > 0;
  useEffect(() => {
    const main = document.querySelector("main.main-content");
    const place = slot;
    if (!showing || !main || !place) return;
    const settle = () => {
      const header = main.querySelector(".page-header");
      if (!header) {
        if (place.isConnected) place.remove();
        return;
      }
      if (place.previousElementSibling !== header || !place.isConnected) header.after(place);
    };
    settle();
    let pending = 0;
    const observer = new MutationObserver(() => {
      if (pending) return;
      pending = requestAnimationFrame(() => {
        pending = 0;
        settle();
      });
    });
    observer.observe(main, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      if (pending) cancelAnimationFrame(pending);
      place.remove();
    };
  }, [showing, slot]);

  if (!writing || !slot) return null;
  return createPortal(
    <div
      className="approval-writes-note text-sm"
      role="status"
      title="The writes run on the server; leaving this page does not stop them. A plan that cannot be written shows under the Failed filter on Floor Plans."
    >
      Writing {writing} approved plan{writing === 1 ? "" : "s"} to Wix…
    </div>,
    slot
  );
}
