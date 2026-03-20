import {
  createContext,
  useContext,
  useCallback,
  useState,
  useRef,
  useEffect,
  type ReactNode,
} from "react";
import "../styles/toast.css";

/* ─── Types ──────────────────────────────────────────────────────── */

type ToastVariant = "success" | "error" | "info";

interface ToastItem {
  id: number;
  message: string;
  variant: ToastVariant;
  exiting: boolean;
}

interface ToastContextValue {
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
}

/* ─── Context ────────────────────────────────────────────────────── */

const ToastContext = createContext<ToastContextValue>({
  success: () => {},
  error: () => {},
  info: () => {},
});

export function useToast(): ToastContextValue {
  return useContext(ToastContext);
}

/* ─── Icons ──────────────────────────────────────────────────────── */

function SuccessIcon() {
  return (
    <svg className="toast-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function ErrorIcon() {
  return (
    <svg className="toast-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" />
    </svg>
  );
}

function InfoIcon() {
  return (
    <svg className="toast-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
  );
}

const ICON_MAP: Record<ToastVariant, () => React.ReactElement> = {
  success: SuccessIcon,
  error: ErrorIcon,
  info: InfoIcon,
};

/* ─── Provider ───────────────────────────────────────────────────── */

const MAX_VISIBLE = 3;
const AUTO_DISMISS_MS = 3000;
const EXIT_ANIMATION_MS = 300;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const counterRef = useRef(0);
  const timersRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  const removeToast = useCallback((id: number) => {
    // Start exit animation
    setToasts((prev) => prev.map((t) => (t.id === id ? { ...t, exiting: true } : t)));

    // Remove after animation completes
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, EXIT_ANIMATION_MS);

    // Clear the timer
    const timer = timersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
  }, []);

  const addToast = useCallback(
    (message: string, variant: ToastVariant) => {
      const id = ++counterRef.current;

      setToasts((prev) => {
        const next = [...prev, { id, message, variant, exiting: false }];
        // If exceeding max, mark oldest non-exiting toasts for removal
        const visible = next.filter((t) => !t.exiting);
        if (visible.length > MAX_VISIBLE) {
          const excess = visible.length - MAX_VISIBLE;
          for (let i = 0; i < excess; i++) {
            removeToast(visible[i].id);
          }
        }
        return next;
      });

      // Auto-dismiss
      const timer = setTimeout(() => {
        removeToast(id);
        timersRef.current.delete(id);
      }, AUTO_DISMISS_MS);
      timersRef.current.set(id, timer);
    },
    [removeToast]
  );

  // Clean up timers on unmount
  useEffect(() => {
    return () => {
      timersRef.current.forEach((timer) => clearTimeout(timer));
      timersRef.current.clear();
    };
  }, []);

  const success = useCallback((msg: string) => addToast(msg, "success"), [addToast]);
  const error = useCallback((msg: string) => addToast(msg, "error"), [addToast]);
  const info = useCallback((msg: string) => addToast(msg, "info"), [addToast]);

  return (
    <ToastContext.Provider value={{ success, error, info }}>
      {children}
      <div className="toast-container" aria-live="polite" aria-atomic="false">
        {toasts.map((toast) => {
          const Icon = ICON_MAP[toast.variant];
          return (
            <div
              key={toast.id}
              className={`toast toast-${toast.variant}${toast.exiting ? " toast-exit" : ""}`}
              role="status"
            >
              <Icon />
              <span className="toast-message">{toast.message}</span>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}
