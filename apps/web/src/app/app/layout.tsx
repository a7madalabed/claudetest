import { dehydrate, HydrationBoundary, QueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { AppShell } from "@/components/app-shell/app-shell";
import { getMe } from "@/lib/api/me";
import { RealtimeProvider } from "@/lib/realtime";
import { queryKeys } from "@/lib/query/keys";

/**
 * The authenticated area. This layout runs on the SERVER: it fetches the current
 * user (redirecting to /login if the session is invalid) and hands the result to
 * the client-side cache via <HydrationBoundary>. Result: the first paint already
 * contains the user and their households — no loading spinner, no second request.
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const me = await getMe();
  const queryClient = new QueryClient();
  queryClient.setQueryData(queryKeys.me, me);

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <RealtimeProvider>
        <AppShell>{children}</AppShell>
      </RealtimeProvider>
    </HydrationBoundary>
  );
}
