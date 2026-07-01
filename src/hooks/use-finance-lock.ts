import { useSyncExternalStore } from "react";

let financeUnlocked = false;
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot() {
  return financeUnlocked;
}

function getServerSnapshot() {
  return false;
}

export function unlockFinanceSession() {
  financeUnlocked = true;
  notify();
}

export function lockFinanceSession() {
  financeUnlocked = false;
  notify();
}

export function useFinanceLock() {
  const isFinanceUnlocked = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return { isFinanceUnlocked, unlockFinanceSession, lockFinanceSession };
}
