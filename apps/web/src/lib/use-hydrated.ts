import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

/**
 * false during server rendering AND during hydration, true afterwards.
 *
 * Why: pages under a <Suspense> boundary hydrate LATER than the app shell
 * ("selective hydration"). If the shell has already fetched the same query
 * (the budget alerts do), the page would hydrate WITH data while the server
 * HTML was rendered WITHOUT it — a hydration mismatch. Rendering the loading
 * state until hydration finishes makes both sides agree.
 */
export const useHydrated = () =>
  useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
