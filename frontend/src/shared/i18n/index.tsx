"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useSyncExternalStore, type ReactNode } from "react";

export type Locale = "ru" | "kk" | "en";
type I18n = { locale: Locale; setLocale: (locale: Locale) => void; t: (ru: string, kk: string, en: string) => string };
const Context = createContext<I18n | null>(null);
const STORAGE_KEY = "delphi-ui-locale";
const CHANGE_EVENT = "delphi-ui-locale-change";

function subscribe(listener: () => void) {
  window.addEventListener("storage", listener);
  window.addEventListener(CHANGE_EVENT, listener);
  return () => {
    window.removeEventListener("storage", listener);
    window.removeEventListener(CHANGE_EVENT, listener);
  };
}

function snapshot(): Locale {
  const value = window.localStorage.getItem(STORAGE_KEY);
  if (value === "kk" || value === "ҚАЗ") return "kk";
  if (value === "en" || value === "EN") return "en";
  return "ru";
}

function setLocale(locale: Locale) {
  window.localStorage.setItem(STORAGE_KEY, locale);
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const locale = useSyncExternalStore(subscribe, snapshot, () => "ru" as const);
  const t = useCallback((ru: string, kk: string, en: string) => ({ ru, kk, en })[locale], [locale]);
  const value = useMemo(() => ({ locale, setLocale, t }), [locale, t]);
  useEffect(() => { document.documentElement.lang = locale; }, [locale]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useI18n(): I18n {
  const value = useContext(Context);
  if (!value) throw new Error("useI18n requires I18nProvider");
  return value;
}
