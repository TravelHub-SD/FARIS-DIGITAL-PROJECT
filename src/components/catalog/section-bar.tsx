"use client";

import { useEffect, useState } from "react";

// Sticky row of section chips under the header. The chips are plain in-page
// links (they work without JavaScript); this small effect only marks the
// section currently on screen. No library.
export function SectionBar({
  sections,
  label,
}: {
  sections: { id: string; label: string }[];
  label: string;
}) {
  const [active, setActive] = useState(sections[0]?.id);
  useEffect(() => {
    const targets = sections
      .map((s) => document.getElementById(`section-${s.id}`))
      .filter((el): el is HTMLElement => el !== null);
    const observer = new IntersectionObserver(
      (entries) => {
        const top = entries
          .filter((e) => e.isIntersecting)
          .sort(
            (a, b) => a.boundingClientRect.top - b.boundingClientRect.top,
          )[0];
        if (top) setActive(top.target.id.slice("section-".length));
      },
      { rootMargin: "-120px 0px -55% 0px" },
    );
    targets.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [sections]);

  return (
    <nav
      aria-label={label}
      className="sticky top-14 z-30 -mx-4 border-b bg-background/95 backdrop-blur"
      data-testid="section-bar"
    >
      <ul className="no-scrollbar flex gap-2 overflow-x-auto px-4 py-2.5">
        {sections.map((s) => {
          const on = s.id === active;
          return (
            <li key={s.id} className="shrink-0">
              <a
                href={`#section-${s.id}`}
                aria-current={on ? "true" : undefined}
                className={`inline-flex h-9 items-center rounded-full border px-3.5 text-sm whitespace-nowrap ${
                  on
                    ? "border-foreground bg-foreground font-bold text-background"
                    : "bg-card hover:border-primary/50"
                }`}
              >
                {s.label}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
