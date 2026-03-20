import { useState, useRef, useEffect, useCallback } from "react";
import type { ConversationListItem } from "../hooks/useConversations";
import "../styles/chat-history.css";

/* ─── Props ──────────────────────────────────────────────────────── */

interface ChatHistoryProps {
  open: boolean;
  onClose: () => void;
  conversations: ConversationListItem[];
  activeConversationId: string | null;
  loading: boolean;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  onRename: (id: string, title: string) => void;
}

/* ─── Helpers ────────────────────────────────────────────────────── */

function formatRelativeDate(dateStr: string | null): string {
  if (!dateStr) return "";
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function getConversationTitle(conv: ConversationListItem): string {
  return conv.title || "New conversation";
}

/* ─── Component ──────────────────────────────────────────────────── */

export function ChatHistory({
  open,
  onClose,
  conversations,
  activeConversationId,
  loading,
  onSelect,
  onNew,
  onDelete,
  onRename,
}: ChatHistoryProps) {
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const editInputRef = useRef<HTMLInputElement>(null);

  // Focus the input when entering edit mode
  useEffect(() => {
    if (editingId && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingId]);

  // Reset editing state when drawer closes
  useEffect(() => {
    if (!open) {
      setEditingId(null);
      setEditTitle("");
      setDeletingId(null);
    }
  }, [open]);

  const handleDelete = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (deletingId === id) {
      // Second click — confirm delete
      onDelete(id);
      setDeletingId(null);
    } else {
      setDeletingId(id);
      // Reset after 3 seconds if not confirmed
      setTimeout(() => setDeletingId(null), 3000);
    }
  };

  const startEditing = (e: React.MouseEvent, conv: ConversationListItem) => {
    e.stopPropagation();
    setEditingId(conv.id);
    setEditTitle(conv.title || "");
    setDeletingId(null);
  };

  const commitRename = useCallback(() => {
    if (!editingId) return;
    const trimmed = editTitle.trim();
    if (trimmed && trimmed !== getConversationTitle({ id: editingId, title: null } as ConversationListItem)) {
      // Only call onRename if the title actually changed
      const original = conversations.find(c => c.id === editingId);
      if (original && trimmed !== (original.title || "")) {
        onRename(editingId, trimmed);
      }
    }
    setEditingId(null);
    setEditTitle("");
  }, [editingId, editTitle, conversations, onRename]);

  const cancelEditing = useCallback(() => {
    setEditingId(null);
    setEditTitle("");
  }, []);

  const handleEditKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      commitRename();
    } else if (e.key === "Escape") {
      e.preventDefault();
      cancelEditing();
    }
  }, [commitRename, cancelEditing]);

  if (!open) return null;

  return (
    <>
      <div className="chat-history-backdrop" onClick={onClose} />
      <aside className="chat-history-drawer" role="complementary" aria-label="Chat history">
        <div className="chat-history-header">
          <span className="chat-history-title">Conversations</span>
          <div className="chat-history-header-actions">
            <button
              className="chat-history-new-btn"
              onClick={onNew}
              title="New conversation"
              aria-label="New conversation"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
              </svg>
            </button>
            <button
              className="chat-history-close-btn"
              onClick={onClose}
              aria-label="Close history"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>

        <div className="chat-history-list">
          {loading ? (
            <div className="chat-history-loading">
              {[1, 2, 3].map(i => (
                <div key={i} className="chat-history-skeleton">
                  <div className="skeleton-title" />
                  <div className="skeleton-meta" />
                </div>
              ))}
            </div>
          ) : conversations.length === 0 ? (
            <div className="chat-history-empty">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
              <span>No conversations yet</span>
            </div>
          ) : (
            conversations.map(conv => (
              <div
                key={conv.id}
                role="button"
                tabIndex={0}
                className={`chat-history-item ${conv.id === activeConversationId ? "active" : ""}`}
                onClick={() => {
                  if (editingId !== conv.id && deletingId !== conv.id) onSelect(conv.id);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    if (editingId !== conv.id && deletingId !== conv.id) onSelect(conv.id);
                  }
                }}
              >
                <div className="chat-history-item-content">
                  {editingId === conv.id ? (
                    <input
                      ref={editInputRef}
                      className="chat-history-rename-input"
                      type="text"
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      onKeyDown={handleEditKeyDown}
                      onBlur={commitRename}
                      onClick={(e) => e.stopPropagation()}
                      maxLength={100}
                    />
                  ) : (
                    <span
                      className="chat-history-item-title"
                      onDoubleClick={(e) => startEditing(e, conv)}
                    >
                      {getConversationTitle(conv)}
                    </span>
                  )}
                  <span className="chat-history-item-meta">
                    {conv.messageCount > 0 && (
                      <span>{conv.messageCount} message{conv.messageCount !== 1 ? "s" : ""}</span>
                    )}
                    {conv.lastMessageAt && (
                      <span>{formatRelativeDate(conv.lastMessageAt)}</span>
                    )}
                  </span>
                </div>
                <div className="chat-history-item-actions">
                  {editingId !== conv.id && (
                    <button
                      className="chat-history-item-edit"
                      onClick={(e) => startEditing(e, conv)}
                      title="Rename conversation"
                      aria-label="Rename conversation"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
                      </svg>
                    </button>
                  )}
                  <button
                    className={`chat-history-item-delete ${deletingId === conv.id ? "confirm" : ""}`}
                    onClick={(e) => handleDelete(e, conv.id)}
                    title={deletingId === conv.id ? "Click again to delete" : "Delete conversation"}
                    aria-label="Delete conversation"
                  >
                    {deletingId === conv.id ? (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    ) : (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                      </svg>
                    )}
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </aside>
    </>
  );
}
