import { useSyncExternalStore } from 'react';

export const ROUTES = ['home', 'assistant', 'voice', 'diagnostics', 'monitor', 'automation', 'activity', 'settings'] as const;
export type Route = (typeof ROUTES)[number];

function current(): Route {
  const hash = window.location.hash.replace(/^#\/?/, '');
  return (ROUTES as readonly string[]).includes(hash) ? (hash as Route) : 'home';
}

function subscribe(cb: () => void) {
  window.addEventListener('hashchange', cb);
  return () => window.removeEventListener('hashchange', cb);
}

export function navigate(route: Route): void {
  if (current() !== route) window.location.hash = `/${route}`;
}

export function useRoute(): Route {
  return useSyncExternalStore(subscribe, current, () => 'home');
}
