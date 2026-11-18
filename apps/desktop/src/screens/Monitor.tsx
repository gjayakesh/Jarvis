import { useState } from 'react';
import { Rows3 } from 'lucide-react';
import { Empty, Panel, ScreenHeader, StatusPill } from '../components/ui';
import { agentMissingText, ago, formatBytes, formatRate, useAgentStatus, usePoll, type HistoryPoint, type Metrics, type ProcessRow } from '../state/agent';

const RANGES = [
  { label: '5 min', minutes: 5 },
  { label: '1 hour', minutes: 60 },
  { label: '24 hours', minutes: 1440 },
];

export function Monitor() {
  const s = useAgentStatus();
  const online = s.agent === 'online';
  const [range, setRange] = useState(RANGES[0]);
  const metrics = usePoll<Metrics>(online ? '/metrics/current' : null, 5000);
  const history = usePoll<{ points: HistoryPoint[] }>(online ? `/metrics/history?minutes=${range.minutes}&points=120` : null, range.minutes <= 5 ? 10_000 : 60_000);
  const gpu = usePoll<{ supported: boolean; name?: string; temperature_c?: number; utilization_percent?: number; memory_used_mb?: number; memory_total_mb?: number; slowdown_c?: number; reason?: string }>(online ? '/system/gpu' : null, 10_000).data;
  const procs = usePoll<{ observed_at: string | null; processes: ProcessRow[] }>(online ? '/processes?limit=15' : null, 15_000);
  const m = metrics.data;

  const rows = [
    { title: 'CPU', reading: m ? `${m.cpu_percent.toFixed(0)}` : '--', unit: '%', what: 'How busy the processor is.', source: m?.sources.cpu },
    { title: 'Memory', reading: m ? `${m.memory_used_percent.toFixed(0)}` : '--', unit: `% used · ${m ? formatBytes(m.memory_available_bytes) : '--'} free`, what: 'Memory in use and free.', source: m?.sources.memory },
    {
      title: 'Disk',
      reading: m?.disk_busy_percent != null ? `${m.disk_busy_percent.toFixed(0)}` : '--',
      unit: `% active · ${formatRate(m?.disk_read_bps)} in · ${formatRate(m?.disk_write_bps)} out`,
      what: 'Read and write activity, all drives.',
      source: m?.sources.disk,
    },
    { title: 'Network', reading: formatRate(m?.net_recv_bps, true).replace(' Mb/s', ''), unit: `Mb/s down · ${formatRate(m?.net_sent_bps, true)} up`, what: 'Download and upload traffic.', source: m?.sources.network },
    {
      title: 'GPU',
      reading: gpu?.supported ? `${gpu.utilization_percent?.toFixed(0) ?? '--'}` : '--',
      unit: gpu?.supported
        ? `% busy · ${gpu.temperature_c?.toFixed(0)} °C (slows at ${gpu.slowdown_c?.toFixed(0) ?? '?'} °C) · ${gpu.memory_used_mb?.toFixed(0)}/${gpu.memory_total_mb?.toFixed(0)} MB`
        : '',
      what: gpu?.supported ? `${gpu.name}: load, temperature and video memory.` : gpu?.reason ?? 'Graphics card load and temperature.',
      source: gpu?.supported ? 'nvidia-smi' : undefined,
    },
  ];

  return (
    <div className="screen">
      <ScreenHeader title="Monitor">Live readings from your PC. Every number shows where it came from and how fresh it is.</ScreenHeader>

      <Panel title="Telemetry" meta={online && m ? <StatusPill tone="ok">Live · {ago(m.observed_at)}</StatusPill> : <StatusPill tone="muted">No data</StatusPill>}>
        <table className="table telemetry">
          <caption className="visually-hidden">Live readings, one row per station</caption>
          <thead>
            <tr>
              <th scope="col">Station</th>
              <th scope="col" className="num">Reading</th>
              <th scope="col">What it shows</th>
              <th scope="col">Source</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.title}>
                <th scope="row" className="telemetry-station mono">
                  {r.title}
                </th>
                <td className={`num telemetry-reading mono ${m ? 'is-live' : ''}`}>
                  {r.reading}
                  <span className="telemetry-unit">{r.unit}</span>
                </td>
                <td className="muted">{r.what}</td>
                <td className="telemetry-source mono">{r.source ?? '--'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!online && <p className="field-hint">{agentMissingText(s)}</p>}
      </Panel>

      <Panel
        title="Trace"
        meta={
          <div className="segmented" role="group" aria-label="Time range">
            {RANGES.map((r) => (
              <button key={r.label} type="button" className={r === range ? 'is-active' : ''} aria-pressed={r === range} onClick={() => setRange(r)}>
                {r.label}
              </button>
            ))}
          </div>
        }
      >
        {history.data && history.data.points.length > 1 ? (
          <Trace points={history.data.points} />
        ) : (
          <p className="muted">{online ? 'Collecting samples. JARVIS records one every 10 seconds.' : agentMissingText(s)}</p>
        )}
      </Panel>

      <Panel title="Processes" meta={procs.data?.observed_at ? <span className="mono">{ago(procs.data.observed_at)}</span> : <StatusPill tone="muted">No data</StatusPill>}>
        {procs.data && procs.data.processes.length > 0 ? (
          <table className="table">
            <caption className="visually-hidden">Busiest running apps</caption>
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col" className="num">PID</th>
                <th scope="col" className="num">CPU</th>
                <th scope="col" className="num">Memory</th>
              </tr>
            </thead>
            <tbody>
              {procs.data.processes.map((p) => (
                <tr key={p.pid}>
                  <td>{p.name}</td>
                  <td className="num mono">{p.pid}</td>
                  <td className="num mono">{p.cpu_percent.toFixed(1)}%</td>
                  <td className="num mono">{formatBytes(p.memory_bytes)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <Empty icon={Rows3} title="No processes to show">
            {online ? 'The first process sample arrives within 30 seconds of JARVIS starting.' : agentMissingText(s)}
          </Empty>
        )}
        <p className="field-hint">CPU is averaged over 30 seconds. JARVIS never ends an app by itself.</p>
      </Panel>
    </div>
  );
}

/** CPU and memory over time, drawn from the agent's 10-second samples. */
function Trace({ points }: { points: HistoryPoint[] }) {
  const w = 1000;
  const h = 160;
  const x = (i: number) => (i / (points.length - 1)) * w;
  const y = (v: number) => h - (Math.max(0, Math.min(100, v)) / 100) * h;
  const line = (key: 'cpu' | 'memory') =>
    points
      .map((p, i) => (p[key] == null ? null : `${x(i).toFixed(1)},${y(p[key] as number).toFixed(1)}`))
      .filter(Boolean)
      .join(' ');
  const first = new Date(points[0].t);
  const last = new Date(points[points.length - 1].t);
  const fmt = (d: Date) => d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const latest = points[points.length - 1];
  return (
    <figure className="trace">
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" role="img" aria-label={`CPU and memory from ${fmt(first)} to ${fmt(last)}`}>
        {[25, 50, 75].map((g) => (
          <line key={g} x1="0" x2={w} y1={y(g)} y2={y(g)} className="trace-grid" />
        ))}
        <polyline points={line('memory')} className="trace-memory" />
        <polyline points={line('cpu')} className="trace-cpu" />
      </svg>
      <figcaption className="trace-legend mono">
        <span className="trace-key is-cpu">CPU {latest.cpu?.toFixed(0) ?? '--'}%</span>
        <span className="trace-key is-memory">Memory {latest.memory?.toFixed(0) ?? '--'}%</span>
        <span className="muted">
          {fmt(first)} – {fmt(last)} · 0–100%
        </span>
      </figcaption>
    </figure>
  );
}
