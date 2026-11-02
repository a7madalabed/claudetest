"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

/**
 * ⌘K actions like "New budget" navigate to a page with ?new=1. This opens the
 * page's create dialog once, then removes the parameter from the URL (so a
 * refresh or Back doesn't open it again).
 *
 * `open` must only set state of the component calling this hook: it runs
 * during render (React's "adjust state while rendering" pattern, no effect).
 */
export function useNewParam(open: () => void) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const wantsNew = searchParams.get("new") === "1";
  const [handled, setHandled] = useState(false);
  if (wantsNew !== handled) {
    setHandled(wantsNew);
    if (wantsNew) open();
  }
  useEffect(() => {
    if (!wantsNew) return;
    const rest = new URLSearchParams(searchParams.toString());
    rest.delete("new");
    router.replace(rest.size ? `${pathname}?${rest}` : pathname, { scroll: false });
  }, [wantsNew, searchParams, router, pathname]);
}
