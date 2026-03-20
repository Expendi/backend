import { useEffect, useState } from "react";

interface SuccessCheckProps {
  size?: number;
  color?: string;
  className?: string;
}

/**
 * Animated SVG checkmark: a circle draws itself, then the check stroke
 * draws inside. Used on transaction success states.
 */
export function SuccessCheck({
  size = 56,
  color = "var(--exo-lime)",
  className,
}: SuccessCheckProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Small delay so the animation starts after the component mounts
    const timer = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(timer);
  }, []);

  const strokeWidth = 2.5;
  const radius = 10;
  const circumference = 2 * Math.PI * radius;

  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      style={{ overflow: "visible" }}
    >
      {/* Circle */}
      <circle
        cx="12"
        cy="12"
        r={radius}
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        fill="none"
        style={{
          strokeDasharray: circumference,
          strokeDashoffset: visible ? 0 : circumference,
          transition: "stroke-dashoffset 0.5s cubic-bezier(0.65, 0, 0.35, 1)",
          transformOrigin: "center",
          transform: "rotate(-90deg)",
        }}
      />
      {/* Checkmark */}
      <polyline
        points="8 12.5 11 15.5 16.5 9"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
        style={{
          strokeDasharray: 20,
          strokeDashoffset: visible ? 0 : 20,
          transition: "stroke-dashoffset 0.35s cubic-bezier(0.65, 0, 0.35, 1) 0.45s",
        }}
      />
    </svg>
  );
}
