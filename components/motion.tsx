"use client";

import { usePathname } from "next/navigation";
import { useLayoutEffect, useRef } from "react";

/**
 * Subtle GSAP motion for the public pages (see docs/DESIGN.md → Motion).
 *
 * - GSAP loads in the background after the page is interactive, so it never
 *   delays first paint or the largest contentful paint.
 * - On the first load, only content that starts below the fold animates (as it
 *   scrolls in). What is already on screen is never hidden, so nothing flashes.
 * - After a client-side navigation, the new page plays a short entrance; the
 *   effect runs before paint, so there is no flash there either.
 * - Off for /admin and for anyone with prefers-reduced-motion. Print shows
 *   everything (globals.css).
 */

type Gsap = typeof import("gsap").gsap;
type ScrollTriggerT = typeof import("gsap/ScrollTrigger").ScrollTrigger;
type Mods = { gsap: Gsap; ScrollTrigger: ScrollTriggerT };

const REVEAL = ".card, .glance, .stat-tile, [data-reveal]";
const BARS = ".bar-track > span, .meter > span";
const COUNT = ".stat-num, [data-count]";
const RINGS = "circle[data-ring]";

let mods: Mods | null = null;
let loading: Promise<Mods> | null = null;
function load(): Promise<Mods> {
  if (mods) return Promise.resolve(mods);
  loading ??= Promise.all([import("gsap"), import("gsap/ScrollTrigger")]).then(([g, s]) => {
    g.gsap.registerPlugin(s.ScrollTrigger);
    mods = { gsap: g.gsap, ScrollTrigger: s.ScrollTrigger };
    return mods;
  });
  return loading;
}

function whenIdle(fn: () => void): () => void {
  if (typeof window.requestIdleCallback === "function") {
    const id = window.requestIdleCallback(fn, { timeout: 2000 });
    return () => window.cancelIdleCallback(id);
  }
  const id = window.setTimeout(fn, 200);
  return () => window.clearTimeout(id);
}

/** Outermost matches only, so a card inside a card animates once, with its parent. */
function outermost(root: Element, sel: string): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(sel)).filter((el) => {
    const parent = el.parentElement?.closest(sel);
    return !parent || !root.contains(parent);
  });
}

function animate({ gsap, ScrollTrigger }: Mods, entrance: boolean) {
  const root = document.getElementById("main");
  if (!root) return null;
  const vh = window.innerHeight;
  const top = (el: Element) => el.getBoundingClientRect().top;
  const START = "top 92%";
  const restore: (() => void)[] = [];

  // The outermost card around an element (null if none, or if it sits in a CSS-animated masthead).
  const cardOf = (el: Element): HTMLElement | null => {
    let found: HTMLElement | null = null;
    for (let c = el.closest<HTMLElement>(REVEAL); c && root.contains(c); c = c.parentElement?.closest<HTMLElement>(REVEAL) ?? null) found = c;
    return found && !found.closest(".masthead") ? found : null;
  };

  const ctx = gsap.context(() => {
    // Cards: on a first load only those wholly below the fold; after a navigation, all of them.
    const cards = outermost(root, REVEAL).filter((el) => !el.closest(".masthead") && (entrance || top(el) > vh));
    const hidden = new Set(cards);
    // A number, ring or bar animates with its card. Outside cards, the same fold rule applies.
    const waits = (el: Element) => {
      const card = cardOf(el);
      return card ? hidden.has(card) : entrance || top(el) > vh;
    };
    const when = (el: Element, run: () => void) => {
      const trigger = cardOf(el) ?? el;
      if (top(trigger) < vh * 0.92) run();
      else ScrollTrigger.create({ trigger, start: START, once: true, onEnter: run });
    };

    // Cards and sections: fade and rise, staggered.
    gsap.set(cards, { opacity: 0, y: 14 });
    const show = (els: Element[]) => gsap.to(els, { opacity: 1, y: 0, duration: 0.45, ease: "power2.out", stagger: 0.05, overwrite: true });
    const now = cards.filter((el) => top(el) < vh * 0.92);
    if (now.length) show(now);
    ScrollTrigger.batch(
      cards.filter((el) => !now.includes(el)),
      { start: START, once: true, onEnter: show },
    );

    // Bars and meters: fill from the left.
    for (const bar of Array.from(root.querySelectorAll<HTMLElement>(BARS)).filter(waits)) {
      gsap.set(bar, { scaleX: 0, transformOrigin: "left center" });
      when(bar, () => gsap.to(bar, { scaleX: 1, duration: 0.7, ease: "power3.out", overwrite: true }));
    }

    // Score rings: rings in view draw with CSS (globals.css); waiting rings draw with their card.
    for (const ring of Array.from(root.querySelectorAll<SVGCircleElement>(RINGS)).filter(waits)) {
      if (entrance && top(ring) < vh) continue; // a freshly inserted ring already plays its CSS draw
      const circ = Number(ring.getAttribute("stroke-dasharray"));
      const target = Number(ring.dataset.ring);
      if (!Number.isFinite(circ) || !Number.isFinite(target)) continue;
      ring.style.animation = "none";
      restore.push(() => {
        ring.style.animation = "";
      });
      gsap.set(ring, { strokeDashoffset: circ });
      when(ring, () => gsap.to(ring, { strokeDashoffset: target, duration: 0.9, ease: "power3.out" }));
    }

    // Whole numbers: count up from zero, with their card.
    for (const el of Array.from(root.querySelectorAll<HTMLElement>(COUNT)).filter(waits)) {
      const original = el.textContent ?? "";
      const raw = original.trim();
      if (!/^\d{1,3}(,\d{3})*$|^\d+$/.test(raw)) continue;
      const end = Number(raw.replace(/,/g, ""));
      if (end === 0) continue;
      const fmt = (n: number) => (raw.includes(",") ? n.toLocaleString("en-US") : String(n));
      const state = { v: 0 };
      el.textContent = fmt(0);
      restore.push(() => {
        el.textContent = original;
      });
      when(el, () =>
        gsap.to(state, {
          v: end,
          duration: 0.8,
          ease: "power2.out",
          onUpdate: () => {
            el.textContent = fmt(Math.round(state.v));
          },
          onComplete: () => {
            el.textContent = original;
          },
        }),
      );
    }
  });

  // Late-loading fonts or images can move things; re-measure the triggers once.
  const refresh = () => ScrollTrigger.refresh();
  if (document.readyState !== "complete") window.addEventListener("load", refresh, { once: true });

  return () => {
    window.removeEventListener("load", refresh);
    ctx.revert();
    restore.forEach((f) => f());
  };
}

/** Cursor spotlight on cards: sets --mx/--my on the card under the pointer (CSS draws it). */
function useSpotlight() {
  useLayoutEffect(() => {
    if (!window.matchMedia("(hover: hover) and (prefers-reduced-motion: no-preference)").matches) return;
    let frame = 0;
    const onMove = (e: PointerEvent) => {
      const card = (e.target as Element | null)?.closest?.<HTMLElement>(".spot, .card.lift");
      if (!card || card.closest("[data-area='admin']")) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const r = card.getBoundingClientRect();
        card.style.setProperty("--mx", `${e.clientX - r.left}px`);
        card.style.setProperty("--my", `${e.clientY - r.top}px`);
      });
    };
    document.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      document.removeEventListener("pointermove", onMove);
      cancelAnimationFrame(frame);
    };
  }, []);
}

export function Motion() {
  const pathname = usePathname();
  const firstLoad = useRef(true);
  useSpotlight();

  useLayoutEffect(() => {
    const entrance = !firstLoad.current;
    firstLoad.current = false;
    if (pathname.startsWith("/admin")) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let cleanup: (() => void) | null = null;
    let cancelled = false;
    // After a navigation with GSAP already loaded, run synchronously (before paint).
    if (entrance && mods) {
      cleanup = animate(mods, true);
      return () => cleanup?.();
    }
    // Otherwise load in the background; treat it as a first load (below the fold only).
    const cancelIdle = whenIdle(() => {
      load()
        .then((m) => {
          if (!cancelled) cleanup = animate(m, false);
        })
        .catch(() => {
          /* motion is decoration; the page is complete without it */
        });
    });
    return () => {
      cancelled = true;
      cancelIdle();
      cleanup?.();
    };
  }, [pathname]);

  return null;
}
