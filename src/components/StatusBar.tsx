import React from 'react';
import type { QueueEvent } from '../scheduler';

// Persistent status bar: shows running task, waiting tasks and live
// rate-limit countdowns ("Rate limit hit, retrying in 18s, attempt 2/8").
export const StatusBar: React.FC<{
  events: QueueEvent[];
  slowMode: boolean;
  onToggleSlow: () => void;
}> = ({ events, slowMode, onToggleSlow }) => {
  const active = [...events].reverse().find((e) => e.status === 'running' || e.status === 'waiting-retry');
  const waiting = events.filter((e) => e.status === 'queued');
  return (
    <div className={`statusbar ${active?.status === 'waiting-retry' ? 'warn' : ''}`}>
      <span className="dot" />
      {active?.status === 'waiting-retry' ? (
        <span className="rate">
          ⚠ Rate limit hit — retrying in {active.retryInSeconds ?? 0}s, attempt {active.attempt}/{active.maxAttempts} · {active.label}
        </span>
      ) : active ? (
        <span>▶ {active.label} <em>(attempt {active.attempt}/{active.maxAttempts})</em></span>
      ) : (
        <span>Idle — queue empty</span>
      )}
      {waiting.length > 0 && <span className="muted"> · waiting: {waiting.length}</span>}
      <span className="spacer" />
      <label className="slowtoggle" title="Doubles all delays between API calls and retries">
        <input type="checkbox" checked={slowMode} onChange={onToggleSlow} /> Slow mode (2× delays)
      </label>
    </div>
  );
};
