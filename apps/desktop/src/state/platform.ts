/**
 * Talks to the JARVIS background host (host/jarvis-host.mjs) when the UI runs
 * inside it. The host injects a per-launch token into index.html; in a normal
 * browser tab or the dev server there is no token and these calls do nothing.
 */
const token = document.querySelector<HTMLMetaElement>('meta[name="jarvis-host-token"]')?.content ?? null;

export const hosted = token !== null;

/**
 * Whether the JARVIS window is actually on screen. Chrome is told to keep this
 * page running while hidden (so it can listen), which also means it cannot tell
 * the page it is hidden; we track it ourselves so animations can pause.
 */
let windowShown = true;
const shownListeners = new Set<() => void>();
function setShown(next: boolean) {
  if (next === windowShown) return;
  windowShown = next;
  document.documentElement.toggleAttribute('data-window-hidden', !next);
  shownListeners.forEach((l) => l());
}
export function isWindowShown(): boolean {
  return windowShown && document.visibilityState === 'visible';
}
export function onWindowShownChange(listener: () => void): () => void {
  shownListeners.add(listener);
  return () => shownListeners.delete(listener);
}

async function call(path: string, body: unknown = {}): Promise<boolean> {
  if (!token) return false;
  try {
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-jarvis-token': token },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      const data = (await res.json().catch(() => ({}))) as { window?: string; result?: string };
      const state = data.window ?? data.result?.replace(/^ok:/, '');
      if (state === 'hidden' || state === 'minimized') setShown(false);
      else if (state === 'shown') setShown(true);
    }
    return res.ok;
  } catch {
    return false;
  }
}

/** Bring the JARVIS window to the front (from hidden or minimised). */
export async function showWindow(): Promise<boolean> {
  setShown(true);
  if (!hosted) {
    try {
      window.focus();
    } catch {
      /* not allowed here */
    }
    return false;
  }
  return call('/host/show');
}

/** Hide the window. JARVIS keeps listening for the wake phrase. */
export function hideWindow(): Promise<boolean> {
  // A plain browser tab cannot hide itself, so only the background app counts as hidden.
  if (!hosted) return Promise.resolve(false);
  setShown(false);
  return call('/host/hide');
}

/** Stop JARVIS completely: closes the window and stops listening until next sign-in. */
export function quitJarvis(): Promise<boolean> {
  return call('/host/quit');
}

/** Start one of the Windows programs the host allows (only in background mode). */
export function openApp(app: string): Promise<boolean> {
  return call('/host/open', { app });
}

/** Open an https page in the user's default browser (a new tab when running in a plain browser). */
export async function openUrl(url: string): Promise<boolean> {
  if (hosted) return call('/host/open', { url });
  window.open(url, '_blank', 'noopener'); // returns null with noopener even when it worked
  return true;
}

/** Lets the host know the page is alive and hearing audio (also used for its log). */
export function startHeartbeat(read: () => Record<string, unknown>): () => void {
  if (!hosted) return () => undefined;
  const beat = () => void call('/host/heartbeat', read());
  beat();
  const id = window.setInterval(beat, 10_000);
  return () => window.clearInterval(id);
}

// Clicking or restoring the window means it is on screen again.
window.addEventListener('focus', () => setShown(true));
