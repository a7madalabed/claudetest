"use client";

import { useLayoutEffect, useRef, useState } from "react";

/**
 * Measures an element and re-measures when it resizes. SVG charts need real
 * pixel widths to place bars and ticks; ResizeObserver keeps them responsive
 * (sidebar collapsing, rotating a phone) without listening to window resize.
 */
export function useSize<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry!.contentRect;
      setSize((s) => (s.width === width && s.height === height ? s : { width, height }));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, size] as const;
}
