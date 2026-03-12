import { useState, type ReactNode } from "react";

interface ActionPanelProps {
  title: string;
  method?: string;
  path?: string;
  children: ReactNode;
  defaultOpen?: boolean;
}

export function ActionPanel({ title, method, path, children, defaultOpen = true }: ActionPanelProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="action-panel">
      <div className="action-panel-header" onClick={() => setOpen(!open)}>
        <div className="action-panel-title">
          {title}
          {method && path && (
            <span className="mono">
              {method} {path}
            </span>
          )}
        </div>
        <span style={{ color: "var(--text-muted)", fontSize: 12 }}>
          {open ? "\u25B2" : "\u25BC"}
        </span>
      </div>
      {open && <div>{children}</div>}
    </div>
  );
}
