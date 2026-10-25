import { useLayoutEffect, type RefObject } from "react";
import gsap from "gsap";

// Entrance reveals hide content until they finish. With GSAP's default lag smoothing a
// throttled tab (background pane, low-power mode) advances only 33ms per slow frame, which
// left cards invisible for many seconds; catch up in real time instead.
gsap.ticker.lagSmoothing(0);

/** Staggered entrance for children marked [data-reveal]; skipped under prefers-reduced-motion. */
export function useReveal(scope: RefObject<HTMLElement>, deps: unknown[] = []) {
  useLayoutEffect(() => {
    if (!scope.current) return;
    const mm = gsap.matchMedia(scope);
    const has = (sel: string) => scope.current!.querySelector(sel) !== null;
    mm.add("(prefers-reduced-motion: no-preference)", () => {
      // fromTo with explicit end values: a plain from() that runs twice (StrictMode, fast
      // re-renders) reads the hidden state as its target and leaves elements invisible.
      if (has("[data-reveal]")) gsap.fromTo("[data-reveal]", { y: 14, opacity: 0 }, { y: 0, opacity: 1, duration: 0.5, ease: "power2.out", stagger: 0.05, clearProps: "all" });
      if (has("[data-bar]")) gsap.fromTo("[data-bar]", { scaleX: 0 }, { scaleX: 1, transformOrigin: "left center", duration: 0.8, ease: "power3.out", stagger: 0.04, clearProps: "transform" });
    });
    return () => mm.revert();
  }, deps);
}
