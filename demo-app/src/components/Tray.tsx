import { useEffect, useRef, useState, useCallback } from "react";
import "../styles/tray.css";

interface TrayProps {
  open: boolean;
  onClose: () => void;
  size?: "small" | "medium" | "large";
  title?: string;
  children: React.ReactNode;
}

type Phase = "closed" | "entering" | "visible" | "exiting";

const DISMISS_THRESHOLD_RATIO = 0.3;
const VELOCITY_DISMISS_THRESHOLD = 0.5;

export function Tray({ open, onClose, size = "medium", title, children }: TrayProps) {
  const [phase, setPhase] = useState<Phase>("closed");
  const sheetRef = useRef<HTMLDivElement>(null);
  const dragStartY = useRef(0);
  const dragCurrentY = useRef(0);
  const dragStartTime = useRef(0);
  const isDragging = useRef(false);

  useEffect(() => {
    if (open && phase === "closed") {
      setPhase("entering");
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setPhase("visible");
        });
      });
    } else if (!open && (phase === "visible" || phase === "entering")) {
      setPhase("exiting");
      const timer = setTimeout(() => {
        setPhase("closed");
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [open, phase]);

  useEffect(() => {
    if (phase !== "visible") return;
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [phase, onClose]);

  useEffect(() => {
    if (phase === "visible" || phase === "entering") {
      document.body.style.overflow = "hidden";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [phase]);

  const handleDragStart = useCallback((clientY: number) => {
    isDragging.current = true;
    dragStartY.current = clientY;
    dragCurrentY.current = clientY;
    dragStartTime.current = Date.now();
    if (sheetRef.current) {
      sheetRef.current.classList.add("tray-sheet-dragging");
    }
  }, []);

  const handleDragMove = useCallback((clientY: number) => {
    if (!isDragging.current || !sheetRef.current) return;
    dragCurrentY.current = clientY;
    const delta = Math.max(0, clientY - dragStartY.current);
    sheetRef.current.style.transform = `translateY(${delta}px)`;
  }, []);

  const handleDragEnd = useCallback(() => {
    if (!isDragging.current || !sheetRef.current) return;
    isDragging.current = false;
    sheetRef.current.classList.remove("tray-sheet-dragging");
    sheetRef.current.style.transform = "";

    const delta = dragCurrentY.current - dragStartY.current;
    const elapsed = Date.now() - dragStartTime.current;
    const velocity = elapsed > 0 ? delta / elapsed : 0;
    const sheetHeight = sheetRef.current.offsetHeight;
    const threshold = sheetHeight * DISMISS_THRESHOLD_RATIO;

    if (delta > threshold || velocity > VELOCITY_DISMISS_THRESHOLD) {
      onClose();
    }
  }, [onClose]);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    handleDragStart(e.clientY);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, [handleDragStart]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    handleDragMove(e.clientY);
  }, [handleDragMove]);

  const onPointerUp = useCallback(() => {
    handleDragEnd();
  }, [handleDragEnd]);

  if (phase === "closed") return null;

  const backdropClasses = [
    "tray-backdrop",
    phase === "visible" ? "tray-backdrop-visible" : "",
    phase === "exiting" ? "tray-backdrop-exiting" : "",
  ].filter(Boolean).join(" ");

  const sheetClasses = [
    "tray-sheet",
    `tray-size-${size}`,
    phase === "visible" ? "tray-sheet-visible" : "",
    phase === "exiting" ? "tray-sheet-exiting" : "",
  ].filter(Boolean).join(" ");

  return (
    <>
      <div className={backdropClasses} onClick={onClose} />
      <div
        ref={sheetRef}
        className={sheetClasses}
        role="dialog"
        aria-modal="true"
        aria-label={title ?? "Detail sheet"}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="tray-handle-area"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <div className="tray-handle" />
        </div>

        {title && (
          <div className="tray-header">
            <span className="tray-title">{title}</span>
            <button className="tray-close" onClick={onClose} aria-label="Close">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        )}

        <div className="tray-content">
          {children}
        </div>
      </div>
    </>
  );
}
