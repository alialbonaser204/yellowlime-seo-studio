import { toast } from '@/hooks/use-toast';

/**
 * Lets people know when a long AI task (profile, topic ideas, outline,
 * article) is finished.
 *
 * - Page visible: a short message on screen.
 * - Page in the background: a browser notification (when allowed), a short
 *   sound and a mark in the tab title until the tab is opened again.
 */

let audio: AudioContext | null = null;
let originalTitle: string | null = null;

/**
 * Call when someone starts a long task (inside the click): asks once for
 * permission to show notifications and prepares the sound.
 */
export function prepareTaskNotifications(): void {
  try {
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      void Notification.requestPermission();
    }
  } catch { /* not supported */ }
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (Ctx && !audio) audio = new Ctx();
    if (audio?.state === 'suspended') void audio.resume();
  } catch { /* no sound */ }
}

function chime(ok: boolean): void {
  if (!audio) return;
  try {
    const notes = ok ? [880, 1320] : [440, 330];
    notes.forEach((freq, i) => {
      const osc = audio!.createOscillator();
      const gain = audio!.createGain();
      const start = audio!.currentTime + i * 0.16;
      osc.frequency.value = freq;
      osc.type = 'sine';
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.18, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.3);
      osc.connect(gain).connect(audio!.destination);
      osc.start(start);
      osc.stop(start + 0.32);
    });
  } catch { /* no sound */ }
}

function markTitle(ok: boolean): void {
  if (originalTitle === null) originalTitle = document.title;
  document.title = `${ok ? '✓ Klaar' : '⚠ Mislukt'} · ${originalTitle}`;
  const restore = () => {
    if (document.hidden) return;
    if (originalTitle !== null) document.title = originalTitle;
    originalTitle = null;
    document.removeEventListener('visibilitychange', restore);
  };
  document.addEventListener('visibilitychange', restore);
}

export function notifyTaskDone({ title, body, ok = true }: { title: string; body?: string; ok?: boolean }): void {
  if (typeof document === 'undefined') return;
  if (!document.hidden) {
    // On screen, errors are already shown where the task was started.
    if (ok) toast({ title, description: body });
    return;
  }
  chime(ok);
  markTitle(ok);
  try {
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      const n = new Notification(title, { body, icon: '/yellowlime-favicon.png', tag: 'yellowlime-task' });
      n.onclick = () => { window.focus(); n.close(); };
    }
  } catch { /* notifications not available */ }
  // Also leave a message for when they come back.
  toast({ title, description: body, variant: ok ? 'default' : 'destructive' });
}
