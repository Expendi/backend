import { type ReactNode } from "react";

interface PageTransitionProps {
  children: ReactNode;
}

/**
 * Simple passthrough wrapper for route content.
 * Keeps the component boundary for future animation support.
 */
export function PageTransition({ children }: PageTransitionProps) {
  return <>{children}</>;
}
