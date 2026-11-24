"use client";

import { useEffect, useRef, useState } from "react";

// Autoplay for the promo slider: the slides stay server-rendered (swipe and
// scroll-snap work without this), this moves to the next one every 5 s.
// It holds while the slider is touched, hovered or focused and goes on 5 s
// after the last interaction; it waits while the tab is hidden or the slider
// is off screen. No autoplay with prefers-reduced-motion. The button pauses
// and plays (WCAG 2.2.2); a pause by the button lasts until Play. It is
// visually hidden until it has keyboard focus (client request 2026-11-24):
// pointer and touch users pause by hovering or touching the slider.
const STEP_MS = 5000;

export function BannerAutoplay({
  pauseLabel,
  playLabel,
}: {
  pauseLabel: string;
  playLabel: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);
  const [playing, setPlaying] = useState(true);
  const playingRef = useRef(true);

  useEffect(() => {
    const track = ref.current
      ?.closest("[data-slider]")
      ?.querySelector<HTMLElement>("[data-slider-track]");
    if (!track) return;
    const reduce = matchMedia("(prefers-reduced-motion: reduce)");
    playingRef.current = !reduce.matches;
    setPlaying(playingRef.current);
    setMounted(true);

    let held = false;
    let visible = true;
    let last = Date.now();
    let ownScrollUntil = 0;
    const touch = () => (last = Date.now());
    const hold = () => {
      held = true;
      touch();
    };
    const release = () => {
      held = false;
      touch();
    };
    const onScroll = () => {
      // A swipe resets the wait; our own smooth scroll does not.
      if (Date.now() > ownScrollUntil) touch();
    };
    const onFocusOut = (e: FocusEvent) => {
      if (!track.contains(e.relatedTarget as Node | null)) release();
    };

    const rtl = getComputedStyle(track).direction === "rtl";
    const advance = () => {
      const slides = [...track.children] as HTMLElement[];
      if (slides.length < 2) return;
      const box = track.getBoundingClientRect();
      const pad =
        parseFloat(getComputedStyle(track).scrollPaddingInlineStart) || 0;
      // Distance from each slide's start edge to the snap line.
      const offset = (el: HTMLElement) => {
        const r = el.getBoundingClientRect();
        return rtl ? r.right - (box.right - pad) : r.left - (box.left + pad);
      };
      let current = 0;
      slides.forEach((el, i) => {
        if (Math.abs(offset(el)) < Math.abs(offset(slides[current])))
          current = i;
      });
      const next = slides[(current + 1) % slides.length];
      ownScrollUntil = Date.now() + 1000;
      track.scrollBy({
        left: offset(next),
        behavior: reduce.matches ? "auto" : "smooth",
      });
    };

    const observer = new IntersectionObserver(
      ([entry]) => (visible = entry.isIntersecting),
      { threshold: 0.5 },
    );
    observer.observe(track);
    const tick = setInterval(() => {
      // While paused, held, off screen or in a hidden tab the wait starts
      // over: playing again always waits a full step first.
      if (
        !playingRef.current ||
        held ||
        !visible ||
        document.visibilityState !== "visible"
      )
        return touch();
      if (Date.now() - last >= STEP_MS) {
        advance();
        touch();
      }
    }, 250);

    const listeners: [string, EventListener][] = [
      ["pointerenter", hold],
      ["pointerleave", release],
      ["pointerdown", hold],
      ["pointerup", release],
      ["touchstart", hold],
      ["touchend", release],
      ["focusin", hold],
      ["focusout", onFocusOut as EventListener],
      ["scroll", onScroll],
    ];
    for (const [type, fn] of listeners)
      track.addEventListener(type, fn, { passive: true });
    const onMotion = () => {
      if (reduce.matches) {
        playingRef.current = false;
        setPlaying(false);
      }
    };
    reduce.addEventListener("change", onMotion);
    return () => {
      clearInterval(tick);
      observer.disconnect();
      for (const [type, fn] of listeners) track.removeEventListener(type, fn);
      reduce.removeEventListener("change", onMotion);
    };
  }, []);

  return (
    // `contents`: the wrapper takes no space; the button is placed against
    // the slider (BannerSlider's section is `relative`).
    <div ref={ref} className="contents">
      {mounted && (
        <button
          type="button"
          data-testid="slider-toggle"
          aria-label={playing ? pauseLabel : playLabel}
          title={playing ? pauseLabel : playLabel}
          onClick={() => {
            playingRef.current = !playing;
            setPlaying(!playing);
          }}
          // Visually hidden (still announced and in the tab order) until it
          // has focus; then shown over the slider's top start corner.
          className="absolute start-7 top-3 z-10 grid size-9 place-items-center rounded-full border bg-card text-foreground shadow-md hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none [&:not(:focus)]:sr-only"
        >
          <svg
            viewBox="0 0 24 24"
            aria-hidden
            className="size-4"
            fill="currentColor"
          >
            {playing ? (
              <path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" />
            ) : (
              <path d="M8 5.5v13a1 1 0 0 0 1.5.86l10-6.5a1 1 0 0 0 0-1.72l-10-6.5A1 1 0 0 0 8 5.5Z" />
            )}
          </svg>
        </button>
      )}
    </div>
  );
}
