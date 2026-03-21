import { useEffect, useRef, useState, type ButtonHTMLAttributes } from "react";
import "../styles/morphing-button.css";

interface MorphingButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
}

/**
 * A button that applies a subtle fade+scale pulse when its label text changes.
 * Used for multi-step flows where the CTA changes between steps.
 */
export function MorphingButton({ label, className = "", ...props }: MorphingButtonProps) {
  const [displayLabel, setDisplayLabel] = useState(label);
  const [morphing, setMorphing] = useState(false);
  const prevLabelRef = useRef(label);
  const timeoutRef = useRef<number | null>(null);

  useEffect(() => {
    if (label !== prevLabelRef.current) {
      prevLabelRef.current = label;
      setMorphing(true);

      // After fade-out completes, swap the label and fade back in
      timeoutRef.current = window.setTimeout(() => {
        setDisplayLabel(label);
        setMorphing(false);
      }, 100);

      return () => {
        if (timeoutRef.current !== null) {
          window.clearTimeout(timeoutRef.current);
        }
      };
    }
  }, [label]);

  return (
    <button className={`${className}`} {...props}>
      <span className={`morphing-label ${morphing ? "morphing-out" : "morphing-in"}`}>
        {displayLabel}
      </span>
    </button>
  );
}
