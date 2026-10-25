"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * `useState` that survives navigation and reloads, backed by localStorage. Same pattern as
 * the portfolio switcher (`portfolio-context.tsx`): a `useSyncExternalStore` over storage, so
 * there's no setState-in-effect (the React-compiler lint forbids it) and SSR renders `initial`.
 * Values must be JSON.
 */
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());
// getSnapshot must return a stable reference while the stored string is unchanged.
const cache = new Map<string, { raw: string | null; value: unknown }>();
// The first `initial` seen per key, so a fresh `[]` literal each render stays one reference.
const initials = new Map<string, unknown>();
const pin = <T>(key: string, initial: T): T => {
  if (!initials.has(key)) initials.set(key, initial);
  return initials.get(key) as T;
};

function read<T>(key: string, initial: T): T {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(key);
  } catch {
    return initial; // private mode / blocked storage
  }
  const hit = cache.get(key);
  if (hit && hit.raw === raw) return hit.value as T;
  let value: T = initial;
  if (raw !== null) {
    try {
      value = JSON.parse(raw) as T;
    } catch {
      value = initial;
    }
  }
  cache.set(key, { raw, value });
  return value;
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  window.addEventListener("storage", cb); // other tabs
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", cb);
  };
}

export function useStoredState<T>(key: string, initialValue: T): [T, (next: T | ((prev: T) => T)) => void] {
  const initial = pin(key, initialValue);
  const value = useSyncExternalStore(
    subscribe,
    () => read(key, initial),
    () => initial,
  );
  const set = useCallback(
    (next: T | ((prev: T) => T)) => {
      const prev = read(key, initial);
      const resolved = typeof next === "function" ? (next as (p: T) => T)(prev) : next;
      try {
        localStorage.setItem(key, JSON.stringify(resolved));
      } catch {
        /* storage full or blocked: the value just won't persist */
      }
      notify();
    },
    [key, initial],
  );
  return [value, set];
}
