import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { errorMessage, isApiError } from "../api/errors";

/** Set while signing out, so the 401s that follow aren't treated as "session expired". */
export const authFlags = { signingOut: false };

/** Sends the user to sign in, remembering where they were. */
function redirectToLogin() {
  if (
    typeof window === "undefined" ||
    authFlags.signingOut ||
    window.location.pathname.startsWith("/login")
  )
    return;
  const next = encodeURIComponent(window.location.pathname + window.location.search);
  // A full page load on purpose (not router.push): this runs outside React, and a
  // reload also discards every piece of in-memory state from the expired session.
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination
  window.location.assign(`/login?next=${next}`);
}

/**
 * One QueryClient per browser tab, with app-wide policies:
 *  - Data is "fresh" for 30 s: navigating back and forth doesn't refetch.
 *  - Retry network blips and 5xx (with backoff) — but never 4xx: a 404 or 403
 *    won't fix itself, and retrying only delays the error message.
 *  - A 401 anywhere means the session ended: go to /login.
 *  - Failed mutations show a toast unless the component handles the error itself.
 */
export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        retry: (failureCount, error) =>
          !(isApiError(error) && error.status < 500) && failureCount < 2,
        refetchOnWindowFocus: true,
      },
    },
    queryCache: new QueryCache({
      onError: (error) => {
        if (isApiError(error) && error.status === 401) redirectToLogin();
      },
    }),
    mutationCache: new MutationCache({
      onError: (error, _variables, _context, mutation) => {
        if (
          isApiError(error) &&
          error.status === 401 &&
          error.code !== "invalid_credentials" &&
          error.code !== "invalid_mfa_code"
        ) {
          return redirectToLogin();
        }
        if (!mutation.meta?.handlesErrors) toast.error(errorMessage(error));
      },
    }),
  });
}

declare module "@tanstack/react-query" {
  interface Register {
    mutationMeta: { handlesErrors?: boolean };
  }
}
