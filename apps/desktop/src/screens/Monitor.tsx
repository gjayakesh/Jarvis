import { Cpu, HardDrive, MemoryStick, Network, Pause, Rows3 } from 'lucide-react';
import { Button, Empty, Panel, ScreenHeader, StatusPill } from '../components/ui';
import { AGENT_MISSING } from '../state/agent';

const METRICS = [
  { title: 'CPU', icon: Cpu, unit: '%', what: 'How busy the processor is, and which apps use it.' },
  { title: 'Memory', icon: MemoryStick, unit: 'GB', what: 'How much memory is in use and how much is free.' },
  { title: 'Disk', icon: HardDrive, unit: 'MB/s', what: 'Read and write activity, and free space per drive.' },
  { title: 'Network', icon: Network, unit: 'Mb/s', what: 'Upload and download traffic per adapter.' },
];

export function Monitor() {
  return (
    <div className="screen">
      <ScreenHeader title="Monitor">Live readings from your PC. Every number shows where it came from and how fresh it is.</ScreenHeader>
      <div className="row screen-tools">
        <span className="mono muted">Range</span>
        <div className="segmented" role="group" aria-label="Time range">
          {['5 min', '1 hour', '24 hours', '7 days'].map((r, i) => (
            <button key={r} type="button" className={i === 0 ? 'is-active' : ''} aria-pressed={i === 0} disabled>
              {r}
            </button>
          ))}
        </div>
        <Button size="sm" variant="ghost" icon={Pause} disabled title={AGENT_MISSING}>
          Pause sampling
        </Button>
      </div>

      <div className="metric-grid">
        {METRICS.map((m) => (
          <Panel key={m.title} title={m.title} meta={<StatusPill tone="muted">No data</StatusPill>} className="metric">
            <div className="metric-empty">
              <span className="metric-value mono" aria-label="No reading">
                --<span className="metric-unit">{m.unit}</span>
              </span>
              <div className="metric-axis" aria-hidden="true">
                {Array.from({ length: 5 }, (_, i) => (
                  <span key={i} />
                ))}
              </div>
              <p className="muted">{m.what}</p>
            </div>
          </Panel>
        ))}
      </div>

      <Panel title="Processes" meta={<StatusPill tone="muted">No data</StatusPill>}>
        <table className="table">
          <caption className="visually-hidden">Running processes</caption>
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col" className="num">PID</th>
              <th scope="col" className="num">CPU</th>
              <th scope="col" className="num">Memory</th>
              <th scope="col" className="num">Disk</th>
              <th scope="col">Publisher</th>
            </tr>
          </thead>
        </table>
        <Empty icon={Rows3} title="No processes to show">
          {AGENT_MISSING} Once it is, running apps are listed here with their CPU, memory and disk use.
        </Empty>
      </Panel>
    </div>
  );
}
