import { createContext, useContext, useRef, type ReactNode } from "react";

interface ChatActionsContextValue {
  sendMessage: (message: string) => void;
  prefillInput: (text: string) => void;
  registerSend: (fn: (message: string) => void) => void;
  registerPrefill: (fn: (text: string) => void) => void;
}

const ChatActionsContext = createContext<ChatActionsContextValue>({
  sendMessage: () => {},
  prefillInput: () => {},
  registerSend: () => {},
  registerPrefill: () => {},
});

export function useChatActions() {
  return useContext(ChatActionsContext);
}

export function ChatActionsProvider({ children }: { children: ReactNode }) {
  const sendFnRef = useRef<((message: string) => void) | null>(null);
  const prefillFnRef = useRef<((text: string) => void) | null>(null);

  const value: ChatActionsContextValue = {
    sendMessage: (message: string) => {
      if (sendFnRef.current) sendFnRef.current(message);
    },
    prefillInput: (text: string) => {
      if (prefillFnRef.current) prefillFnRef.current(text);
    },
    registerSend: (fn: (message: string) => void) => {
      sendFnRef.current = fn;
    },
    registerPrefill: (fn: (text: string) => void) => {
      prefillFnRef.current = fn;
    },
  };

  return (
    <ChatActionsContext.Provider value={value}>
      {children}
    </ChatActionsContext.Provider>
  );
}
