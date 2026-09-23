"use client";

import { useSyncExternalStore } from "react";
import { toast as sonner } from "sonner";

export type Notification = { id: string; message: string; kind: "success" | "error" | "info"; createdAt: Date; read: boolean };
const EMPTY: Notification[] = [];
let items: Notification[] = EMPTY;
const listeners = new Set<() => void>();

function publish() { listeners.forEach((listener) => listener()); }
function add(message: string, kind: Notification["kind"]) {
  items = [{ id: crypto.randomUUID(), message, kind, createdAt: new Date(), read: false }, ...items].slice(0, 30);
  publish();
}

export const toast = {
  success(message: string) { add(message, "success"); return sonner.success(message); },
  error(message: string) { add(message, "error"); return sonner.error(message); },
  info(message: string) { add(message, "info"); return sonner.info(message); },
};

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function useNotifications() {
  return useSyncExternalStore(subscribe, () => items, () => EMPTY);
}

export function markNotificationsRead() {
  items = items.map((item) => ({ ...item, read: true }));
  publish();
}

export function clearNotifications() {
  items = EMPTY;
  publish();
}
