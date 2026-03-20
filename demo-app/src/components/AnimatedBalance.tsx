import { useEffect, useRef, useState } from "react";

interface AnimatedBalanceProps {
  value: number;
  decimals?: number;
  duration?: number;
  className?: string;
}

/**
 * Smoothly animates a numeric balance between old and new values
 * using requestAnimationFrame for fluid 60fps interpolation.
 */
export function AnimatedBalance({
  value,
  decimals = 2,
  duration = 600,
  className,
}: AnimatedBalanceProps) {
  const [displayValue, setDisplayValue] = useState(value);
  const prevValueRef = useRef(value);
  const rafRef = useRef<number | null>(null);
  const startTimeRef = useRef<number | null>(null);

  useEffect(() => {
    const from = prevValueRef.current;
    const to = value;

    if (from === to) return;

    prevValueRef.current = to;
    startTimeRef.current = null;

    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
    }

    const animate = (timestamp: number) => {
      if (startTimeRef.current === null) {
        startTimeRef.current = timestamp;
      }

      const elapsed = timestamp - startTimeRef.current;
      const progress = Math.min(elapsed / duration, 1);

      // Ease-out cubic for a natural deceleration feel
      const eased = 1 - Math.pow(1 - progress, 3);

      const current = from + (to - from) * eased;
      setDisplayValue(current);

      if (progress < 1) {
        rafRef.current = requestAnimationFrame(animate);
      } else {
        setDisplayValue(to);
        rafRef.current = null;
      }
    };

    rafRef.current = requestAnimationFrame(animate);

    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [value, duration]);

  return (
    <span className={className}>
      {displayValue.toLocaleString(undefined, {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      })}
    </span>
  );
}
