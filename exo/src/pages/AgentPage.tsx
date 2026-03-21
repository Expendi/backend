import { useEffect, useRef, useCallback, useState } from "react";
import { useNavigate } from "react-router-dom";
import { usePrivy } from "@privy-io/react-auth";
import { useGlove, Render } from "glove-react";
import { useApi } from "../hooks/useApi";
import { useDashboard } from "../context/DashboardContext";
import { useChatActions } from "../context/ChatActionsContext";
import { useConversations } from "../hooks/useConversations";
import { ChatHistory } from "../components/ChatHistory";
import { setApiFetcher } from "../tools/api";
import { setTokenGetter, setActiveConversationId } from "../lib/glove-client";
import { Markdown } from "../components/Markdown";
import "../styles/chat.css";
import "../styles/agent-dashboard.css";

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

/* ─── Thinking Indicator ──────────────────────────────────────────── */

function ThinkingIndicator() {
  return (
    <div className="chat-thinking-indicator">
      <div className="chat-avatar thinking-avatar" aria-hidden="true">
        <span className="avatar-exo">e</span>
      </div>
      <div className="thinking-content">
        <div className="think-dots">
          <div className="think-dot" />
          <div className="think-dot" />
          <div className="think-dot" />
        </div>
      </div>
    </div>
  );
}

/* ─── Message Skeleton (initial load) ────────────────────────────── */

function MessageSkeleton() {
  return (
    <div className="chat-skeleton-container">
      {[1, 2, 3].map(i => (
        <div key={i} className={`chat-skeleton-msg ${i % 2 === 0 ? "user" : "assistant"}`}>
          <div className="chat-skeleton-avatar" />
          <div className="chat-skeleton-body">
            <div className="chat-skeleton-line" style={{ width: i === 1 ? "75%" : i === 2 ? "45%" : "60%" }} />
            {i !== 2 && <div className="chat-skeleton-line" style={{ width: i === 1 ? "50%" : "80%" }} />}
          </div>
        </div>
      ))}
    </div>
  );
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
  const navigate = useNavigate();

  // Inbox banner state
  const [inboxUnreadCount, setInboxUnreadCount] = useState(0);
  const [bannerDismissed, setBannerDismissed] = useState(false);

  useEffect(() => {
    let mounted = true;

    const fetchUnread = async () => {
      try {
        const data = await request<{ total: number }>("/agent/inbox/unread");
        if (mounted) {
          setInboxUnreadCount(data.total);
          if (data.total === 0) setBannerDismissed(false);
        }
      } catch {
        // Silently ignore polling failures
      }
    };

    fetchUnread();
    const interval = setInterval(fetchUnread, 30000);

    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [request]);

  const showBanner = inboxUnreadCount > 0 && !bannerDismissed;

  // Conversation persistence — drives the sessionId for Glove's store
  const convos = useConversations();
  const conversationId = convos.activeConversation?.id ?? undefined;

  // Glove uses the conversation ID as sessionId.
  // The store adapter (createRemoteStore in glove-client.ts) fetches/saves messages via the conversation API.
  // When conversationId changes, Glove remounts with the new session and auto-loads messages.
  const glove = useGlove({ sessionId: conversationId });

  const inputRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const dashboard = useDashboard();
  const chatActions = useChatActions();
  const [historyOpen, setHistoryOpen] = useState(false);

  // Compaction summary tracking — compaction summaries are stored as "user" messages with is_compaction: true
  // They appear in the timeline as { kind: "user" } entries. We track indices to hide from UI and skip when persisting.
  const [compactionIndices, setCompactionIndices] = useState<Set<number>>(new Set());
  const compactionIndicesRef = useRef<Set<number>>(new Set());
  const wasCompactingRef = useRef(false);
  const preCompactionLengthRef = useRef(0);
  useEffect(() => {
    if (glove.isCompacting && !wasCompactingRef.current) {
      preCompactionLengthRef.current = glove.timeline.length;
    }
    if (wasCompactingRef.current && !glove.isCompacting) {
      const updated = new Set(compactionIndicesRef.current);
      for (let i = preCompactionLengthRef.current; i < glove.timeline.length; i++) {
        updated.add(i);
      }
      compactionIndicesRef.current = updated;
      setCompactionIndices(updated);
    }
    wasCompactingRef.current = glove.isCompacting;
  }, [glove.isCompacting, glove.timeline]);

  // Wire auth and API
  useEffect(() => { setTokenGetter(getAccessToken); }, [getAccessToken]);
  useEffect(() => { setApiFetcher(request); }, [request]);

  // Tell the chat client which conversation to persist messages to (for server-side persistence in chat.ts)
  useEffect(() => {
    setActiveConversationId(conversationId ?? null);
    return () => setActiveConversationId(null);
  }, [conversationId]);

  const sendMessage = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || glove.busy || !conversationId) return;
      glove.sendMessage(trimmed);
    },
    [glove, conversationId]
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
  const scrollToBottom = useCallback((instant?: boolean) => {
    messagesEndRef.current?.scrollIntoView({ behavior: instant ? "instant" : "smooth" });
  }, []);
  // Scroll on new timeline entries or streaming
  useEffect(() => { scrollToBottom(); }, [glove.timeline.length, glove.streamingText, glove.slots.length, scrollToBottom]);
  // Scroll to bottom when conversation changes (Glove auto-loads messages via store)
  const prevConvId = useRef(conversationId);
  useEffect(() => {
    if (conversationId && conversationId !== prevConvId.current) {
      // Small delay to let Glove populate the timeline from the store
      const t = setTimeout(() => scrollToBottom(true), 100);
      prevConvId.current = conversationId;
      return () => clearTimeout(t);
    }
    prevConvId.current = conversationId;
  }, [conversationId, scrollToBottom]);

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

  // Chat history handlers
  const handleSelectConversation = useCallback(async (id: string) => {
    if (id === convos.activeConversation?.id) {
      setHistoryOpen(false);
      return;
    }
    await convos.loadConversation(id);
    setHistoryOpen(false);
  }, [convos]);

  const handleNewConversation = useCallback(async () => {
    await convos.createConversation();
    setHistoryOpen(false);
  }, [convos]);

  const handleDeleteConversation = useCallback(async (id: string) => {
    await convos.deleteConversation(id);
  }, [convos]);

  const handleRenameConversation = useCallback(async (id: string, title: string) => {
    await convos.updateTitle(id, title);
  }, [convos]);

  const hasMessages = glove.timeline.length > 0;
  const isInitialLoading = convos.loading && glove.timeline.length === 0;

  // Determine if we should show the thinking indicator:
  // Show when glove is busy but there's no streaming text and no tool is running
  const hasRunningTool = glove.timeline.some(e => e.kind === "tool" && e.status === "running");
  const showThinking = glove.busy && !glove.streamingText && !hasRunningTool && !glove.isCompacting;

  return (
    <div className="chat-page">
      {/* Chat History Toggle */}
      <div className="chat-header-bar">
        <button
          className="chat-history-toggle"
          onClick={() => setHistoryOpen(true)}
          title="Chat history"
          aria-label="Open chat history"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="3" y1="12" x2="15" y2="12" />
            <line x1="3" y1="18" x2="18" y2="18" />
          </svg>
        </button>
        <span className="chat-header-title">
          {convos.activeConversation?.title || "New conversation"}
        </span>
        <button
          className="chat-new-convo-btn"
          onClick={handleNewConversation}
          title="New conversation"
          aria-label="New conversation"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
          </svg>
        </button>
      </div>

      {showBanner && (
        <div
          className="inbox-banner"
          onClick={() => navigate("/agent/dashboard")}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") navigate("/agent/dashboard"); }}
        >
          <span className="inbox-banner-text">
            exo has <strong>{inboxUnreadCount}</strong> new insight{inboxUnreadCount !== 1 ? "s" : ""} — tap to view
          </span>
          <button
            className="inbox-banner-close"
            onClick={(e) => { e.stopPropagation(); setBannerDismissed(true); }}
            aria-label="Dismiss banner"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      )}

      <div className="chat-container">
        <div className="chat-messages">
          {isInitialLoading ? (
            <MessageSkeleton />
          ) : (
            <>
              {!hasMessages && <AgentEmptyState onAction={handleQuickAction} />}

              {/* Glove timeline — includes restored messages loaded via store adapter */}
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

              {/* Thinking indicator — shown when waiting for first token */}
              {showThinking && <ThinkingIndicator />}
            </>
          )}
          <div ref={messagesEndRef} />
        </div>
        <div className="chat-input-wrapper">
          <div className="chat-input-area">
            <textarea
              ref={inputRef}
              placeholder={glove.busy ? "Thinking..." : "Message exo..."}
              disabled={glove.busy || !conversationId}
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
              disabled={glove.busy || !conversationId}
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

      {/* Chat History Drawer */}
      <ChatHistory
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        conversations={convos.conversations}
        activeConversationId={convos.activeConversation?.id ?? null}
        loading={convos.listLoading}
        onSelect={handleSelectConversation}
        onNew={handleNewConversation}
        onDelete={handleDeleteConversation}
        onRename={handleRenameConversation}
      />
    </div>
  );
}
