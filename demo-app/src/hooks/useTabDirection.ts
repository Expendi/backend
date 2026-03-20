import { useRef, useState, useCallback } from "react";

/**
 * Tracks directional tab switching for applying slide animations.
 * Returns the current slide direction class and a handler to switch tabs.
 */
export function useTabDirection<T extends string>(
  tabOrder: readonly T[],
  initialTab: T
): {
  tab: T;
  setTab: (newTab: T) => void;
  slideClass: string;
} {
  const [tab, setTabState] = useState<T>(initialTab);
  const prevIdxRef = useRef(tabOrder.indexOf(initialTab));
  const [slideClass, setSlideClass] = useState("");

  const setTab = useCallback(
    (newTab: T) => {
      const newIdx = tabOrder.indexOf(newTab);
      const prevIdx = prevIdxRef.current;
      if (newIdx !== prevIdx && newIdx >= 0) {
        setSlideClass(
          newIdx > prevIdx ? "slide-from-right" : "slide-from-left"
        );
        prevIdxRef.current = newIdx;
      }
      setTabState(newTab);
    },
    [tabOrder]
  );

  return { tab, setTab, slideClass };
}
