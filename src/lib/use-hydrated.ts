import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

/**
 * False in the server HTML and until React has hydrated, true afterwards.
 * Forms that submit through onSubmit stay disabled until then: a click before
 * hydration would otherwise submit natively (GET), putting the form's values
 * in the URL and browser history.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}
