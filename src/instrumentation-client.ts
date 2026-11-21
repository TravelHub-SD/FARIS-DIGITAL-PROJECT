// Busy indicator: <html data-busy> while an App Router navigation or a
// Server Action is pending; globals.css draws a thin bar at the top. Runs
// before hydration (Next's client instrumentation), so every request is
// seen. No React component, no loading boundary: a loading.tsx above a
// guarded page turns its 404 into a 200 (decisions.md, Phase 9).
//
// - A navigation starts at onRouterTransitionStart and ends when Next writes
//   the new URL to history as it shows the new page (pushState/replaceState).
//   Back/forward writes nothing: it ends when its requests have settled.
// - A Server Action is a fetch with the Next-Action header: pending until it
//   settles, then until the page it updates is shown (a history write) or
//   400 ms, whichever comes first.
// Prefetches are background work and never count.

let requests = 0;
let navigating = false;
let traverse = false;
let actionTail = false;
let endTimer: ReturnType<typeof setTimeout> | undefined;
let safetyTimer: ReturnType<typeof setTimeout> | undefined;

function render() {
  const busy = navigating || actionTail || requests > 0;
  const root = document.documentElement;
  if (busy) root.setAttribute("data-busy", "");
  else root.removeAttribute("data-busy");
}

function settle() {
  navigating = false;
  actionTail = false;
  clearTimeout(endTimer);
  clearTimeout(safetyTimer);
  render();
}

/** Ends a back/forward navigation once nothing is in flight for a moment. */
function endWhenIdle(delay: number) {
  clearTimeout(endTimer);
  endTimer = setTimeout(() => {
    if (requests === 0) settle();
  }, delay);
}

export function onRouterTransitionStart(
  _url: string,
  navigationType: "push" | "replace" | "traverse",
) {
  navigating = true;
  traverse = navigationType === "traverse";
  clearTimeout(safetyTimer);
  safetyTimer = setTimeout(settle, 15_000);
  if (traverse) endWhenIdle(150);
  render();
}

try {
  for (const method of ["pushState", "replaceState"] as const) {
    const write = history[method];
    history[method] = function (...args: Parameters<History["pushState"]>) {
      const result = write.apply(this, args);
      if ((navigating && !traverse) || actionTail) settle();
      return result;
    };
  }

  const fetchOriginal = window.fetch;
  window.fetch = function (input: RequestInfo | URL, init?: RequestInit) {
    const promise = fetchOriginal.call(window, input, init);
    const headers = new Headers(
      init?.headers ?? (input instanceof Request ? input.headers : undefined),
    );
    const action = headers.has("next-action");
    const page =
      headers.has("rsc") &&
      !headers.has("next-router-prefetch") &&
      !headers.has("next-router-segment-prefetch");
    if (!action && !page) return promise;
    requests++;
    render();
    const done = () => {
      requests--;
      if (action) {
        actionTail = true;
        clearTimeout(endTimer);
        endTimer = setTimeout(() => {
          actionTail = false;
          render();
        }, 400);
      } else if (traverse) endWhenIdle(150);
      render();
    };
    promise.then(done, done);
    return promise;
  };
} catch {
  // The indicator is cosmetic: never let it break the page.
}
