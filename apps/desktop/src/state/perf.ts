/**
 * Cheap counters for JARVIS's own running cost, sent with the host heartbeat
 * (and so written to host status) to check that it stays light while hidden.
 */
const counters = { coreFrames: 0, coreMs: 0, shellRenders: 0, homeRenders: 0, vadFrames: 0, vadCalls: 0, vadMs: 0, transcriptions: 0, transcribeMs: 0 };
let since = performance.now();

export function count(key: keyof typeof counters, amount = 1): void {
  counters[key] += amount;
}

/** Per-second rates since the last call, then reset. */
export function takePerf(): Record<string, number> {
  const now = performance.now();
  const secs = Math.max(0.001, (now - since) / 1000);
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(counters)) {
    out[k] = Math.round((v / secs) * 100) / 100;
    counters[k as keyof typeof counters] = 0;
  }
  since = now;
  return out;
}
