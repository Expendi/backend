import { useState, useCallback, useRef, useEffect } from "react";
import { useApi } from "./useApi";

/* ─── Types (mirrors backend schema) ─────────────────────────────── */

export interface ConversationMessage {
  role: "user" | "agent";
  content: string;
  timestamp: string;
  toolCalls?: Array<{
    name: string;
    input: Record<string, unknown>;
    output?: Record<string, unknown>;
  }>;
}

export interface Conversation {
  id: string;
  userId: string;
  title: string | null;
  isActive: boolean;
  messages: ConversationMessage[];
  tokenCount: number;
  lastMessageAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ConversationListItem {
  id: string;
  title: string | null;
  isActive: boolean;
  messageCount: number;
  lastMessageAt: string | null;
  createdAt: string;
}

/* ─── Hook ───────────────────────────────────────────────────────── */

export function useConversations() {
  const { request } = useApi();

  const [conversations, setConversations] = useState<ConversationListItem[]>([]);
  const [activeConversation, setActiveConversation] = useState<Conversation | null>(null);
  const [loading, setLoading] = useState(true);
  const [listLoading, setListLoading] = useState(false);

  // Prevent double-init
  const initRef = useRef(false);

  /* ── List all conversations ──────────────────────────────────── */

  const fetchConversations = useCallback(async () => {
    setListLoading(true);
    try {
      const data = await request<ConversationListItem[]>("/agent/conversations");
      setConversations(data);
    } catch (err) {
      console.error("Failed to fetch conversations:", err);
    } finally {
      setListLoading(false);
    }
  }, [request]);

  /* ── Get or create the active conversation ───────────────────── */

  const fetchActiveConversation = useCallback(async () => {
    try {
      const data = await request<Conversation>("/agent/conversations/active");
      setActiveConversation(data);
      return data;
    } catch {
      return null;
    }
  }, [request]);

  /* ── Load a specific conversation ────────────────────────────── */

  const loadConversation = useCallback(async (id: string) => {
    setLoading(true);
    try {
      const data = await request<Conversation>(`/agent/conversations/${id}`);
      setActiveConversation(data);
      return data;
    } catch {
      return null;
    } finally {
      setLoading(false);
    }
  }, [request]);

  /* ── Create a new conversation ───────────────────────────────── */

  const createConversation = useCallback(async (title?: string) => {
    try {
      const data = await request<Conversation>("/agent/conversations", {
        method: "POST",
        body: title ? { title } : {},
      });
      setActiveConversation(data);
      // Refresh the list
      fetchConversations();
      return data;
    } catch {
      return null;
    }
  }, [request, fetchConversations]);

  /* ── Append a message ────────────────────────────────────────── */

  const appendMessage = useCallback(async (
    conversationId: string,
    role: "user" | "agent",
    content: string,
    toolCalls?: ConversationMessage["toolCalls"]
  ) => {
    try {
      await request(`/agent/conversations/${conversationId}/message`, {
        method: "POST",
        body: { role, content, ...(toolCalls && { toolCalls }) },
      });
    } catch {
      // Silently fail — persistence is best-effort
    }
  }, [request]);

  /* ── Update conversation title ───────────────────────────────── */

  const updateTitle = useCallback(async (id: string, title: string) => {
    try {
      await request(`/agent/conversations/${id}`, {
        method: "PATCH",
        body: { title },
      });
      // Update in local list
      setConversations(prev =>
        prev.map(c => c.id === id ? { ...c, title } : c)
      );
      if (activeConversation?.id === id) {
        setActiveConversation(prev => prev ? { ...prev, title } : prev);
      }
    } catch (err) {
      console.error("Failed to update conversation title:", err);
    }
  }, [request, activeConversation?.id]);

  /* ── Delete conversation ─────────────────────────────────────── */

  const deleteConversation = useCallback(async (id: string) => {
    try {
      await request(`/agent/conversations/${id}`, { method: "DELETE" });
      setConversations(prev => prev.filter(c => c.id !== id));
      // If we deleted the active one, create a new one.
      // We call createConversation via a fresh reference from the returned
      // promise chain rather than closing over it to avoid stale closures.
      setActiveConversation(prev => {
        if (prev?.id === id) {
          // Trigger new conversation creation outside the state setter
          queueMicrotask(() => {
            request<Conversation>("/agent/conversations", {
              method: "POST",
              body: {},
            })
              .then(data => {
                setActiveConversation(data);
                fetchConversations();
              })
              .catch(err => {
                console.error("Failed to create replacement conversation after delete:", err);
              });
          });
          return null;
        }
        return prev;
      });
    } catch (err) {
      console.error("Failed to delete conversation:", err);
    }
  }, [request, fetchConversations]);

  /* ── Initialize on mount ─────────────────────────────────────── */

  const initialize = useCallback(async () => {
    if (initRef.current) return;
    initRef.current = true;
    setLoading(true);
    try {
      await Promise.all([fetchConversations(), fetchActiveConversation()]);
    } finally {
      setLoading(false);
    }
  }, [fetchConversations, fetchActiveConversation]);

  useEffect(() => {
    initialize();
  }, [initialize]);

  return {
    conversations,
    activeConversation,
    loading,
    listLoading,
    fetchConversations,
    fetchActiveConversation,
    loadConversation,
    createConversation,
    appendMessage,
    updateTitle,
    deleteConversation,
  };
}
