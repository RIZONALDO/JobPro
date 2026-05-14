import { createContext, useContext, useRef } from "react";

type OpenDmFn = (userId: number, prefill?: string) => void;

interface ChatContextValue {
  openDmWith: OpenDmFn;
  _register: (fn: OpenDmFn) => () => void;
}

const ChatContext = createContext<ChatContextValue>({
  openDmWith: () => {},
  _register: () => () => {},
});

export function ChatProvider({ children }: { children: React.ReactNode }) {
  const fnRef = useRef<OpenDmFn | null>(null);
  return (
    <ChatContext.Provider value={{
      openDmWith: (userId, prefill) => fnRef.current?.(userId, prefill),
      _register: fn => {
        fnRef.current = fn;
        return () => { fnRef.current = null; };
      },
    }}>
      {children}
    </ChatContext.Provider>
  );
}

export const useChatContext = () => useContext(ChatContext);
