import { useEffect, useRef, useState } from 'react';
import brandMark from '../assets/yellowlime-mark.png';

/**
 * Loading state for long AI tasks: the spinning Yellowlime mark, a percentage,
 * a bar and the steps. With `progress` the percentage follows real steps
 * (e.g. pages read); without it, it is an estimate that runs towards 95% and
 * only reaches 100% when the task is really done.
 */
export function useEstimatedProgress(active: boolean, expectedMs: number, floor = 0, ceiling = 95): number {
  const [pct, setPct] = useState(0);
  const started = useRef<number | null>(null);
  useEffect(() => {
    if (!active) { started.current = null; setPct(0); return; }
    started.current = Date.now();
    const timer = setInterval(() => {
      const t = Date.now() - (started.current ?? Date.now());
      // Reaches about 80% of the way at the expected time, then slows down.
      const share = 1 - Math.exp((-1.6 * t) / expectedMs);
      setPct(Math.round(floor + (ceiling - floor) * share));
    }, 250);
    return () => clearInterval(timer);
  }, [active, expectedMs, floor, ceiling]);
  return pct;
}

export interface ProgressStep {
  label: string;
  /** Percentage from which this step is the current one. */
  at: number;
}

export function ProgressPanel({ title, subtitle, steps, pct, done = false, testId }: {
  title: string;
  subtitle?: string;
  steps: ProgressStep[];
  pct: number;
  done?: boolean;
  testId?: string;
}) {
  const shown = done ? 100 : Math.min(99, Math.max(0, Math.round(pct)));
  const current = steps.reduce((idx, step, i) => (shown >= step.at ? i : idx), 0);
  return (
    <div className="progress-panel" role="status" aria-live="polite" data-testid={testId ?? 'progress-panel'}>
      <div className="progress-panel-head">
        <span className="progress-panel-mark"><img src={brandMark} alt="" className="progress-panel-logo" /></span>
        <span className="progress-panel-text"><strong>{title}</strong>{subtitle && <small>{subtitle}</small>}</span>
        <strong className="progress-panel-pct" data-testid="progress-pct">{shown}%</strong>
      </div>
      <div className="progress-panel-bar"><span style={{ width: `${shown}%` }} /></div>
      <ol className="progress-panel-steps">
        {steps.map((step, i) => {
          const state = done || i < current ? 'done' : i === current ? 'now' : 'todo';
          return <li key={step.label} className={`is-${state}`}><span className="progress-panel-dot" aria-hidden="true">{state === 'done' ? '✓' : state === 'now' ? '•' : ''}</span>{step.label}</li>;
        })}
      </ol>
    </div>
  );
}
