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
  // On a first load, leave anything at or above the fold alone.
  const eligible = (el: Element) => entrance || el.getBoundingClientRect().top > vh * 0.95;
  const inView = (el: Element) => el.getBoundingClientRect().top < vh * 0.95;
  const restore: (() => void)[] = [];

  const ctx = gsap.context(() => {
    // Cards and sections: fade and rise.
    const cards = outermost(root, REVEAL).filter(eligible);
    gsap.set(cards, { opacity: 0, y: 14 });
    const show = (els: Element[]) => gsap.to(els, { opacity: 1, y: 0, duration: 0.45, ease: "power2.out", stagger: 0.05, overwrite: true });
    const now = cards.filter(inView);
    if (now.length) show(now);
    ScrollTrigger.batch(
      cards.filter((el) => !now.includes(el)),
      { start: "top 95%", once: true, onEnter: show },
    );

    // Bars and meters: fill from the left.
    const bars = Array.from(root.querySelectorAll<HTMLElement>(BARS)).filter(eligible);
    gsap.set(bars, { scaleX: 0, transformOrigin: "left center" });
    const fill = (els: Element[]) => gsap.to(els, { scaleX: 1, duration: 0.7, ease: "power3.out", stagger: 0.03, overwrite: true });
    const barsNow = bars.filter(inView);
    if (barsNow.length) fill(barsNow);
    ScrollTrigger.batch(
      bars.filter((el) => !barsNow.includes(el)),
      { start: "top 95%", once: true, onEnter: fill },
    );

    // Whole numbers: count up from zero.
    for (const el of Array.from(root.querySelectorAll<HTMLElement>(COUNT)).filter(eligible)) {
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
      const run = () =>
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
        });
      if (inView(el)) run();
      else ScrollTrigger.create({ trigger: el, start: "top 95%", once: true, onEnter: run });
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

export function Motion() {
  const pathname = usePathname();
  const firstLoad = useRef(true);

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
