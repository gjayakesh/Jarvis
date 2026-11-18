import { useSyncExternalStore } from 'react';

/**
 * Timers, reminders and alarms set by voice. Kept on this PC so they survive a
 * restart of the JARVIS window; one that came due while JARVIS was closed is
 * still announced if it is less than 10 minutes late.
 */
export interface Alert {
  id: string;
  kind: 'timer' | 'reminder' | 'alarm';
  /** Timer name ("pasta"), reminder text, or "" for plain timers and alarms. */
  label: string;
  at: number;
  /** Original timer length, for "your 5 minute timer is done". */
  durationMs?: number;
}

const KEY = 'jarvis.alerts.v1';
const LATE_LIMIT = 10 * 60_000;

let alerts: Alert[] = [];
const handles = new Map<string, number>();
const listeners = new Set<() => void>();
let ring: (alert: Alert) => void = () => undefined;

function save(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(alerts));
  } catch {
    /* keep in memory */
  }
  listeners.forEach((l) => l());
}

function schedule(alert: Alert): void {
  // setTimeout tops out at ~24.8 days; re-check long waits in steps.
  const wait = Math.min(alert.at - Date.now(), 2 ** 31 - 1);
  handles.set(
    alert.id,
    window.setTimeout(() => {
      if (Date.now() < alert.at - 500) return schedule(alert);
      handles.delete(alert.id);
      alerts = alerts.filter((a) => a.id !== alert.id);
      save();
      ring(alert);
    }, Math.max(0, wait)),
  );
}

/** Start the alerts saved last time and say what to do when one is due. */
export function startAlerts(onRing: (alert: Alert) => void): void {
  ring = onRing;
  let saved: Alert[] = [];
  try {
    saved = JSON.parse(localStorage.getItem(KEY) ?? '[]') as Alert[];
  } catch {
    /* nothing saved */
  }
  alerts = saved.filter((a) => a.at > Date.now() - LATE_LIMIT);
  handles.forEach((h) => window.clearTimeout(h));
  handles.clear();
  alerts.forEach(schedule);
  save();
}

export function addAlert(alert: Omit<Alert, 'id'>): Alert {
  const full = { ...alert, id: `al_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}` };
  alerts = [...alerts, full].sort((a, b) => a.at - b.at);
  schedule(full);
  save();
  return full;
}

/** Cancel everything; returns how many were cancelled. */
export function cancelAlerts(): number {
  const n = alerts.length;
  handles.forEach((h) => window.clearTimeout(h));
  handles.clear();
  alerts = [];
  save();
  return n;
}

export function cancelAlert(id: string): void {
  const h = handles.get(id);
  if (h) window.clearTimeout(h);
  handles.delete(id);
  alerts = alerts.filter((a) => a.id !== id);
  save();
}

export function getAlerts(): Alert[] {
  return alerts;
}

export function useAlerts(): Alert[] {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => alerts,
  );
}
