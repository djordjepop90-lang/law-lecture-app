import React from 'react';
import { ENGINE, TIMING } from '../config';
import type { SystemVoice } from '../audio';

interface Props {
  voices: SystemVoice[];
  voiceURI: string;
  onVoice: (uri: string) => void;
  slowMode: boolean;
  onSlowMode: (b: boolean) => void;
  theme: 'dark' | 'light';
  onTheme: (t: 'dark' | 'light') => void;
  onClearCache: () => void;
  onResume: () => void;
  hasDoc: boolean;
}

const SettingsPanel: React.FC<Props> = ({ voices, voiceURI, onVoice, slowMode, onSlowMode, theme, onTheme, onClearCache, onResume, hasDoc }) => (
  <details className="settings">
    <summary>⚙ Settings</summary>
    <div className="settings-grid">
      <label className="row" style={{ gridColumn: '1 / -1' }}>
        Engine: <b>{ENGINE.name}</b> <span className="muted small">— no API key, everything runs locally in your browser</span>
      </label>
      <label>
        Voice (browser speechSynthesis)
        <select value={voiceURI} onChange={(e) => onVoice(e.target.value)}>
          {voices.length === 0 && <option value="">(system voices loading…)</option>}
          {voices.map((v) => <option key={v.voiceURI} value={v.voiceURI}>{v.name} ({v.lang})</option>)}
        </select>
      </label>
      <label>
        Text engine <input value={ENGINE.text} readOnly />
      </label>
      <label>
        Voice engine <input value={ENGINE.voice} readOnly />
      </label>
      <label className="row">
        <input type="checkbox" checked={slowMode} onChange={(e) => onSlowMode(e.target.checked)} /> Slow mode ({TIMING.slowModeMultiplier}× all pacing delays)
      </label>
      <label>
        Theme
        <select value={theme} onChange={(e) => onTheme(e.target.value as 'dark' | 'light')}>
          <option value="dark">Dark</option>
          <option value="light">Light</option>
        </select>
      </label>
      <div className="row gap">
        <button onClick={onResume} disabled={!hasDoc}>▶ Resume last job</button>
        <button className="danger" onClick={onClearCache}>🗑 Clear cache (IndexedDB)</button>
      </div>
      <p className="muted small">
        Generation runs sequentially through one queue (text lane), so the UI never blocks and progress is always visible in the status bar.
        All results are cached in IndexedDB — reload loses nothing.
      </p>
    </div>
  </details>
);

export default SettingsPanel;
