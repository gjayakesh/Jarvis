/**
 * Connection to the local JARVIS agent (Python FastAPI sidecar, spec §7 and §9).
 * The agent is not built yet, so the UI reports that honestly instead of
 * inventing readings (spec FR-002). When the Tauri shell exists it will pass
 * the loopback port and per-launch token here.
 */
export type ServiceStatus = 'not-installed' | 'offline' | 'online';

export interface AgentInfo {
  agent: ServiceStatus;
  localAi: ServiceStatus;
  cloudAi: 'off';
  lastScan: string | null;
}

export const AGENT: AgentInfo = {
  agent: 'not-installed',
  localAi: 'not-installed',
  cloudAi: 'off',
  lastScan: null,
};

export const AGENT_MISSING = 'The JARVIS agent is not installed yet, so there is no PC data to show.';
