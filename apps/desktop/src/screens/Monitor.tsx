import { Pause, Rows3 } from 'lucide-react';
import { Button, Empty, Panel, ScreenHeader, StatusPill } from '../components/ui';
import { AGENT_MISSING } from '../state/agent';

const METRICS = [
  { title: 'CPU', unit: '%', source: 'Windows performance counters', what: 'How busy the processor is, and which apps use it.' },
  { title: 'Memory', unit: 'GB', source: 'Windows memory status', what: 'How much memory is in use and how much is free.' },
  { title: 'Disk', unit: 'MB/s', source: 'Disk counters per drive', what: 'Read and write activity, and free space per drive.' },
  { title: 'Network', unit: 'Mb/s', source: 'Adapter counters', what: 'Upload and download traffic per adapter.' },
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

      <Panel title="Telemetry" meta={<StatusPill tone="muted">No data</StatusPill>}>
        <table className="table telemetry">
          <caption className="visually-hidden">Live readings, one row per station</caption>
          <thead>
            <tr>
              <th scope="col">Station</th>
              <th scope="col" className="num">Reading</th>
              <th scope="col">What it shows</th>
              <th scope="col">Source</th>
              <th scope="col">Status</th>
            </tr>
          </thead>
          <tbody>
            {METRICS.map((m) => (
              <tr key={m.title}>
                <th scope="row" className="telemetry-station mono">
                  {m.title}
                </th>
                <td className="num telemetry-reading mono" aria-label={`No ${m.title} reading`}>
                  --<span className="telemetry-unit">{m.unit}</span>
                </td>
                <td className="muted">{m.what}</td>
                <td className="telemetry-source mono">{m.source}</td>
                <td>
                  <StatusPill tone="muted">No data</StatusPill>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="field-hint">{AGENT_MISSING} Readings and a trace over the chosen range appear here once it is.</p>
      </Panel>

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
