// Free-tier Supabase projects pause on inactivity and cold-start slowly.
// Bound every request so a paused database surfaces as a handled error
// (error boundary / retry) instead of a hung serverless function.
export function createTimeoutFetch(timeoutMs: number): typeof fetch {
  return (input, init) => {
    const timeout = AbortSignal.timeout(timeoutMs);
    const signal = init?.signal
      ? AbortSignal.any([init.signal, timeout])
      : timeout;
    return fetch(input, { ...init, signal });
  };
}

export const fetchWithTimeout = createTimeoutFetch(10_000);
