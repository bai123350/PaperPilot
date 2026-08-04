import { useCallback, useEffect, useState } from "react";

import type { ConversationModel } from "./api";

const storageKey = "paperpilot.conversationModel";
const changeEvent = "paperpilot:conversation-model-change";

export function readConversationModel(): ConversationModel {
  if (typeof window === "undefined") return "deepseek-v4-pro";
  const saved = window.localStorage.getItem(storageKey);
  return saved === "deepseek-v4-flash"
    || saved === "gpt-5-mini"
    || saved === "qwen-plus"
    ? saved
    : "deepseek-v4-pro";
}

export function useConversationModel() {
  const [model, setModelState] = useState<ConversationModel>("deepseek-v4-pro");

  useEffect(() => {
    const sync = () => setModelState(readConversationModel());
    sync();
    window.addEventListener("storage", sync);
    window.addEventListener(changeEvent, sync);
    return () => {
      window.removeEventListener("storage", sync);
      window.removeEventListener(changeEvent, sync);
    };
  }, []);

  const setModel = useCallback((nextModel: ConversationModel) => {
    window.localStorage.setItem(storageKey, nextModel);
    setModelState(nextModel);
    window.dispatchEvent(new Event(changeEvent));
  }, []);

  return [model, setModel] as const;
}
