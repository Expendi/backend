import { useEffect, useRef, useCallback, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useGlove, Render } from "glove-react";
import { useApi } from "../hooks/useApi";
import { useDashboard } from "../context/DashboardContext";
import { useChatActions } from "../context/ChatActionsContext";
import { setApiFetcher } from "../tools/api";
import { setTokenGetter } from "../lib/glove-client";
import { Markdown } from "../components/Markdown";
import "../styles/chat.css";

/* ─── Quick Suggestions (agent-appropriate) ─────────────────────── */

const SUGGESTIONS: readonly { label: string; prompt: string; icon: string; autoSend?: boolean }[] = [
  { label: "Spending", prompt: "How much have I spent this month?", icon: "chart" },
  { label: "Portfolio", prompt: "Show my portfolio breakdown", icon: "pie" },
  { label: "Yield", prompt: "What yield opportunities are available?", icon: "yield" },
  { label: "Recurring", prompt: "Show my recurring payments", icon: "clock" },
  { label: "Send", prompt: "Send ", icon: "send", autoSend: false },
  { label: "Swap", prompt: "Swap ", icon: "swap", autoSend: false },
];

/* ─── Tool Status Icons ───────────────────────────────────────────── */

function ToolRunningIcon() {
  return (
    <svg className="tool-status-spinner" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
      <path d="M12 2a10 10 0 0 1 10 10" />
    </svg>
  );
}

function ToolSuccessIcon() {
  return (
    <svg className="tool-status-check" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function ToolErrorIcon() {
  return (
    <svg className="tool-status-error-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" />
    </svg>
  );
}

function formatToolName(name: string): string {
  return name
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/* ─── Empty State ─────────────────────────────────────────────────── */

function AgentEmptyState({ onAction }: { onAction: (prompt: string, autoSend: boolean) => void }) {
  return (
    <div className="chat-empty-state">
      <div className="empty-glow" aria-hidden="true" />
      <div className="empty-logo-section">
        <div className="chat-empty-logo">exo<span className="dot">.</span></div>
        <p className="chat-empty-tagline">Your AI crypto assistant</p>
        <p className="chat-empty-subtitle">
          Ask me about spending insights, portfolio analysis, or complex multi-step operations.
        </p>
      </div>
      <div className="chat-quick-actions">
        {SUGGESTIONS.map((s) => (
          <button
            key={s.label}
            className="chat-quick-action"
            onClick={() => onAction(s.prompt, s.autoSend !== false)}
          >
            <span className="chat-quick-text">
              <span className="chat-quick-label">{s.label}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

/* ─── Agent Page ──────────────────────────────────────────────────── */

export function AgentPage() {
  const { request } = useApi();
  const { getAccessToken } = usePrivy();
  const glove = useGlove();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const dashboard = useDashboard();
  const chatActions = useChatActions();

  // Compaction summary tracking
  const [compactionIndices, setCompactionIndices] = useState<Set<number>>(new Set());
  const wasCompactingRef = useRef(false);
  useEffect(() => {
    if (wasCompactingRef.current && !glove.isCompacting) {
      const idx = glove.timeline.findLastIndex((e) => e.kind === "agent_text");
      if (idx >= 0) setCompactionIndices((prev) => new Set(prev).add(idx));
    }
    wasCompactingRef.current = glove.isCompacting;
  }, [glove.isCompacting, glove.timeline]);

  // Wire auth and API
  useEffect(() => { setTokenGetter(getAccessToken); }, [getAccessToken]);
  useEffect(() => { setApiFetcher(request); }, [request]);

  const sendMessage = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || glove.busy) return;
      glove.sendMessage(trimmed);
    },
    [glove]
  );

  const prefillInput = useCallback((text: string) => {
    if (inputRef.current) {
      inputRef.current.value = text;
      inputRef.current.focus();
    }
  }, []);

  // Register with ChatActionsContext
  useEffect(() => { chatActions?.registerSend?.(sendMessage); }, [chatActions, sendMessage]);
  useEffect(() => { chatActions?.registerPrefill?.(prefillInput); }, [chatActions, prefillInput]);

  // Auto-scroll
  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);
  useEffect(() => { scrollToBottom(); }, [glove.timeline.length, glove.streamingText, glove.slots.length, scrollToBottom]);

  // Refresh dashboard after tool completions
  const lastToolCountRef = useRef(0);
  useEffect(() => {
    if (!dashboard?.refresh) return;
    const completedTools = glove.timeline.filter(
      (e) => e.kind === "tool" && (e.status === "success" || e.status === "error")
    ).length;
    if (completedTools > lastToolCountRef.current) {
      lastToolCountRef.current = completedTools;
      dashboard.refresh();
    }
  }, [glove.timeline, dashboard]);

  const handleQuickAction = useCallback(
    (prompt: string, autoSend: boolean) => {
      if (autoSend) sendMessage(prompt);
      else prefillInput(prompt);
    },
    [sendMessage, prefillInput]
  );

  const hasMessages = glove.timeline.length > 0;

  return (
    <div className="chat-page">
      <div className="chat-container">
        <div className="chat-messages">
          {!hasMessages && <AgentEmptyState onAction={handleQuickAction} />}
          <Render
            glove={glove}
            strategy="interleaved"
            renderMessage={({ entry, index }) => {
              if (compactionIndices.has(index)) return null;
              return (
                <div className={`chat-message ${entry.kind === "user" ? "user" : "assistant"}`}>
                  <div className="chat-avatar" aria-hidden="true">
                    {entry.kind === "user" ? (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
                      </svg>
                    ) : (
                      <span className="avatar-exo">e</span>
                    )}
                  </div>
                  <div className="chat-body">
                    {entry.kind === "user" ? (
                      entry.text.split("\n").map((line, j) => <div key={j}>{line || "\u00A0"}</div>)
                    ) : (
                      <Markdown content={entry.text} />
                    )}
                  </div>
                </div>
              );
            }}
            renderToolStatus={({ entry }) => (
              <div className={`tool-status ${entry.status}`}>
                <div className="tool-status-indicator">
                  {entry.status === "running" && <ToolRunningIcon />}
                  {entry.status === "success" && <ToolSuccessIcon />}
                  {entry.status === "error" && <ToolErrorIcon />}
                </div>
                <div className="tool-status-content">
                  <span className="tool-status-name">{formatToolName(entry.name)}</span>
                  {entry.status === "running" && <span className="tool-status-label">Running</span>}
                  {entry.status === "success" && <span className="tool-status-label success">Done</span>}
                  {entry.status === "error" && (
                    <span className="tool-status-label error">
                      {entry.output ? String(entry.output).slice(0, 80) : "Failed"}
                    </span>
                  )}
                </div>
              </div>
            )}
            renderStreaming={({ text }) =>
              glove.isCompacting ? (
                <div className="chat-thinking">
                  <div className="think-dots"><div className="think-dot" /><div className="think-dot" /><div className="think-dot" /></div>
                  <span>Compacting context...</span>
                </div>
              ) : (
                <div className="chat-message assistant streaming">
                  <div className="chat-avatar" aria-hidden="true"><span className="avatar-exo">e</span></div>
                  <div className="chat-body">
                    <Markdown content={text} />
                    <span className="streaming-cursor" aria-hidden="true" />
                  </div>
                </div>
              )
            }
            renderInput={() => null}
            renderSlotContainer={({ slots, renderSlot }) => (
              <div className="glove-slots">{slots.map(renderSlot)}</div>
            )}
          />
          <div ref={messagesEndRef} />
        </div>
        <div className="chat-input-wrapper">
          <div className="chat-input-area">
            <textarea
              ref={inputRef}
              placeholder={glove.busy ? "Thinking..." : "Message exo..."}
              disabled={glove.busy}
              rows={1}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  const val = inputRef.current?.value.trim();
                  if (val) { sendMessage(val); if (inputRef.current) inputRef.current.value = ""; }
                }
              }}
              onInput={(e) => {
                const target = e.target as HTMLTextAreaElement;
                target.style.height = "auto";
                target.style.height = `${Math.min(target.scrollHeight, 120)}px`;
              }}
            />
            <button
              className="chat-send-btn"
              disabled={glove.busy}
              onClick={() => {
                const val = inputRef.current?.value.trim();
                if (val) { sendMessage(val); if (inputRef.current) inputRef.current.value = ""; }
              }}
              aria-label="Send message"
            >
              {glove.busy ? (
                <span className="spinner-small" />
              ) : (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="12" y1="19" x2="12" y2="5" /><polyline points="5 12 12 5 19 12" />
                </svg>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
