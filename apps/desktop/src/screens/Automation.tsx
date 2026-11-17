import { AppWindow, BellRing, Plus, Workflow } from 'lucide-react';
import { Button, Empty, Panel, ScreenHeader } from '../components/ui';

const NEEDS_AGENT = 'Saving apps, workflows and reminders needs the JARVIS agent.';

export function Automation() {
  return (
    <div className="screen">
      <ScreenHeader title="Automation">
        Approved apps, saved workflows and reminders. JARVIS only opens what you have added here; it never runs commands it made up.
      </ScreenHeader>
      <div className="auto-grid">
        <Panel title="Approved apps">
          <Empty
            icon={AppWindow}
            title="No apps approved"
            action={
              <Button icon={Plus} disabled title={NEEDS_AGENT}>
                Add an app
              </Button>
            }
          >
            Add the apps JARVIS may open for you, like your browser or code editor.
          </Empty>
        </Panel>
        <Panel title="Workflows">
          <Empty
            icon={Workflow}
            title="No workflows"
            action={
              <Button icon={Plus} disabled title={NEEDS_AGENT}>
                New workflow
              </Button>
            }
          >
            A workflow opens a set of apps and folders together, for example “Open my development setup”. You see a preview and can cancel.
          </Empty>
        </Panel>
        <Panel title="Reminders">
          <Empty
            icon={BellRing}
            title="No reminders"
            action={
              <Button icon={Plus} disabled title={NEEDS_AGENT}>
                New reminder
              </Button>
            }
          >
            Reminders you create, snooze and complete will appear here and as Windows notifications.
          </Empty>
        </Panel>
      </div>
      <p className="field-hint">{NEEDS_AGENT}</p>
    </div>
  );
}
