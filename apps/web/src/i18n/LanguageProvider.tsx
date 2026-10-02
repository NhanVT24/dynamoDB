"use client";

import { useEffect, useSyncExternalStore, type ReactNode } from "react";
import { getLanguage, languageStorageKey, restoreLanguage, setLanguage, subscribeLanguage, type Language } from "./language";

export function useLanguage(): Language {
  return useSyncExternalStore(subscribeLanguage, getLanguage, () => "en");
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    restoreLanguage();
    function syncSelection(event: StorageEvent) {
      if (event.key === languageStorageKey) setLanguage(event.newValue === "vi" ? "vi" : "en");
    }
    window.addEventListener("storage", syncSelection);
    return () => window.removeEventListener("storage", syncSelection);
  }, []);
  return <>{children}</>;
}
