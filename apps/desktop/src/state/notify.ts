import { getProfile, updateProfile } from './profile';
import { showWindow } from './platform';

/**
 * Windows notifications (spec G5) through the JARVIS window's own Chrome
 * profile, which Windows shows as toasts. One tag per kind of event, so a
 * repeated event replaces its earlier toast instead of piling up.
 */

export function notificationsSupported(): boolean {
  return typeof Notification !== 'undefined';
}

export function notificationState(): 'on' | 'off' | 'blocked' | 'unsupported' {
  if (!notificationsSupported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'blocked';
  return getProfile().notifications && Notification.permission === 'granted' ? 'on' : 'off';
}

/** Turn notifications on (asks Chrome once) or off. Returns the resulting state. */
export async function setNotifications(on: boolean): Promise<ReturnType<typeof notificationState>> {
  if (!on) {
    updateProfile({ notifications: false });
    return notificationState();
  }
  if (!notificationsSupported()) return 'unsupported';
  const permission = Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission;
  updateProfile({ notifications: permission === 'granted' });
  return notificationState();
}

export function notify(title: string, body: string, tag: string): void {
  if (notificationState() !== 'on') return;
  try {
    const n = new Notification(title, { body, tag, icon: '/favicon.svg', silent: false });
    n.onclick = () => {
      void showWindow();
      window.focus();
      n.close();
    };
  } catch {
    /* the browser refused: nothing else to do */
  }
}
