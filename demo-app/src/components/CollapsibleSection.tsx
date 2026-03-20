import { useState } from "react";
import "../styles/bottom-sheet.css";

interface CollapsibleSectionProps {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}

export function CollapsibleSection({ title, defaultOpen = false, children }: CollapsibleSectionProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="collapsible-section">
      <button
        className={`collapsible-header ${open ? "collapsible-open" : ""}`}
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
      >
        <span>{title}</span>
        <span className={`collapsible-chevron ${open ? "collapsible-chevron-open" : ""}`}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </span>
      </button>
      <div className={`collapsible-body ${open ? "collapsible-body-open" : ""}`}>
        <div className="collapsible-body-inner">
          {children}
        </div>
      </div>
    </div>
  );
}
