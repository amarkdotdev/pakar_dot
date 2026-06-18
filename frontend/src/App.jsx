import { useState, useEffect, useCallback, useRef } from 'react';
import CityPicker from './CityPicker.jsx';
import './App.css';

// ── Status definitions ────────────────────────────────────────────────────────
const STATUS = {
  green: {
    color: '#00e676',
    glow: '0 0 80px #00e67650, 0 0 160px #00e67620',
    bgAccent: 'transparent',
    labelHe: 'ירוק - אפשר להמשיך',
    label: 'GREEN - GOOD TO GO',
    descHe: 'אין התרעות פעילות בעיר שנבחרה',
    desc: 'No active alerts for the selected city',
    pulse: 0,
    flashBg: false,
  },
  yellow: {
    color: '#ffd600',
    glow: '0 0 80px #ffd60060, 0 0 160px #ffd60025',
    bgAccent: '#1a1500',
    labelHe: 'צהוב - להישאר בקרבת מרחב מוגן',
    label: 'YELLOW - STAY CLOSE',
    descHe: 'יש אזהרה / עדכון. הישארו קרובים למרחב מוגן',
    desc: 'Warning/update: stay close to protected space',
    pulse: 1.6,
    flashBg: false,
  },
  red: {
    color: '#ff1744',
    glow: '0 0 100px #ff174480, 0 0 200px #ff174430',
    bgAccent: '#1a0005',
    labelHe: 'אזעקה — היכנסו למרחב המוגן',
    label: 'SIREN — ENTER SHELTER',
    descHe: 'היכנסו מיד למרחב המוגן והישארו עד הודעת שחרור רשמית',
    desc: 'Enter shelter and stay until official all-clear',
    pulse: 0.45,
    flashBg: true,
  },
  unknown: {
    color: '#444',
    glow: 'none',
    bgAccent: 'transparent',
    labelHe: 'בודק מול פיקוד העורף...',
    label: 'Checking Pikud HaOref...',
    descHe: '',
    desc: '',
    pulse: 2.5,
    flashBg: false,
  },
};

const DEFAULT_CITY = {
  value: 'מעלה אדומים',
  label_he: 'מעלה אדומים',
  label: "Ma'aleh Edomim",
  zone_he: 'יהודה',
  zone_en: 'Yehuda',
  countdown: 90,
};

const PREVIEW_STATUS = (() => {
  const value = new URLSearchParams(window.location.search).get('dockPreview');
  return ['green', 'yellow', 'red', 'unknown'].includes(value) ? value : null;
})();

function formatTime(ms) {
  if (!ms) return 'Waiting for first check';
  return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function reasonLabel(reason) {
  const labels = {
    clear: 'clear',
    oref_all_clear: 'official all-clear',
    active_alert: 'active alert',
    oref_warning: 'official warning',
    waiting_oref_all_clear: 'waiting for official all-clear',
    poll_error: 'poll error',
    preview: 'preview',
  };
  return labels[reason] || reason?.replace(/_/g, ' ') || '';
}

// ── Audio ─────────────────────────────────────────────────────────────────────
function beep(freq, duration, volume = 0.45) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(volume, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + duration);
  } catch { /* AudioContext blocked before user gesture */ }
}

function alertSound(status) {
  if (status === 'red') {
    beep(880, 0.4);
    setTimeout(() => beep(1100, 0.4), 450);
    setTimeout(() => beep(880, 0.6), 900);
    if (navigator.vibrate) navigator.vibrate([400, 150, 400, 150, 600]);
  } else if (status === 'yellow') {
    beep(660, 0.5, 0.3);
    if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
  }
}

function dockIconDataUrl(status) {
  const color = STATUS[status]?.color ?? STATUS.unknown.color;
  const shadow = ({
    green: '#0a6c41',
    yellow: '#896d00',
    red: '#7f102a',
    unknown: '#4a4a4a',
  })[status] ?? '#4a4a4a';
  const ring = ({
    green: '#073322',
    yellow: '#433400',
    red: '#370612',
    unknown: '#242424',
  })[status] ?? '#242424';

  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.fillStyle = '#0b0b0b';
  ctx.beginPath();
  ctx.roundRect(0, 0, 512, 512, 122);
  ctx.fill();

  ctx.fillStyle = shadow;
  ctx.globalAlpha = 0.34;
  ctx.beginPath();
  ctx.arc(256, 256, 194, 0, Math.PI * 2);
  ctx.fill();

  ctx.globalAlpha = 1;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(256, 256, 172, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = ring;
  ctx.lineWidth = 24;
  ctx.beginPath();
  ctx.arc(256, 256, 172, 0, Math.PI * 2);
  ctx.stroke();

  ctx.fillStyle = 'rgba(255,255,255,0.18)';
  ctx.beginPath();
  ctx.arc(210, 198, 54, 0, Math.PI * 2);
  ctx.fill();

  return canvas.toDataURL('image/png');
}

// ── App ───────────────────────────────────────────────────────────────────────
export default function App() {
  const [city, setCity] = useState(() => {
    try { return JSON.parse(localStorage.getItem('pakardot_city')) || DEFAULT_CITY; } catch { return DEFAULT_CITY; }
  });
  const [status, setStatus]       = useState('unknown');
  const [alertTitle, setTitle]    = useState('');
  const [reason, setReason]       = useState('');
  const [lastChecked, setLastChecked] = useState(null);
  const [pollMs, setPollMs]       = useState(5000);
  const [picking, setPicking]     = useState(false);
  const [connected, setConnected] = useState(false);
  const [wakeLock, setWakeLock]   = useState(false);
  const [wakeLockSupported, setWLSupported] = useState(false);
  const [updateStatus, setUpdateStatus] = useState(null);

  const wsRef         = useRef(null);
  const wakeLockRef   = useRef(null);
  const prevStatus    = useRef(null);
  const reconnectRef  = useRef(null);

  useEffect(() => {
    if (!localStorage.getItem('pakardot_city')) {
      localStorage.setItem('pakardot_city', JSON.stringify(DEFAULT_CITY));
    }
  }, []);

  useEffect(() => {
    document.body.classList.toggle('is-electron', navigator.userAgent.includes('Electron'));
  }, []);

  useEffect(() => {
    window.pakardotDock?.setStatus(status, dockIconDataUrl(status));
  }, [status]);

  useEffect(() => {
    if (PREVIEW_STATUS) return undefined;

    const updates = window.pakardotUpdates;
    if (!updates) return undefined;

    const off = updates.onStatus((next) => setUpdateStatus(next));
    updates.check().then((next) => {
      if (next?.state && next.state !== 'checking') setUpdateStatus(next);
    }).catch(() => {});

    return off;
  }, []);

  // ── Wake Lock ───────────────────────────────────────────────────────────────
  useEffect(() => {
    setWLSupported('wakeLock' in navigator);
  }, []);

  const requestWL = useCallback(async () => {
    if (!('wakeLock' in navigator)) return;
    try {
      if (wakeLockRef.current) await wakeLockRef.current.release().catch(() => {});
      wakeLockRef.current = await navigator.wakeLock.request('screen');
      setWakeLock(true);
      wakeLockRef.current.addEventListener('release', () => {
        setWakeLock(false);
        wakeLockRef.current = null;
      });
    } catch { setWakeLock(false); }
  }, []);

  const releaseWL = useCallback(async () => {
    try { await wakeLockRef.current?.release(); } catch {}
    wakeLockRef.current = null;
    setWakeLock(false);
  }, []);

  // Re-acquire wake lock when tab becomes visible again
  useEffect(() => {
    const onVisChange = () => {
      if (document.visibilityState === 'visible' && wakeLock) requestWL();
    };
    document.addEventListener('visibilitychange', onVisChange);
    return () => document.removeEventListener('visibilitychange', onVisChange);
  }, [wakeLock, requestWL]);

  // ── WebSocket ───────────────────────────────────────────────────────────────
  const connect = useCallback((cityValue) => {
    clearTimeout(reconnectRef.current);
    if (wsRef.current) { wsRef.current.onclose = null; wsRef.current.close(); }

    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${proto}//${location.host}/ws`);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      ws.send(JSON.stringify({ type: 'subscribe', city: cityValue }));
    };

    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type !== 'status') return;
        const next = msg.status;
        setTitle(msg.alertTitle || '');
        setReason(msg.reason || '');
        setLastChecked(msg.lastCheckedAt || null);
        setPollMs(msg.pollMs || 5000);
        setStatus(prev => {
          if (prev !== next) alertSound(next);
          prevStatus.current = next;
          return next;
        });
      } catch {}
    };

    ws.onclose = () => {
      setConnected(false);
      setStatus('unknown');
      reconnectRef.current = setTimeout(() => connect(cityValue), 3000);
    };

    ws.onerror = () => ws.close();
  }, []);

  useEffect(() => {
    if (PREVIEW_STATUS) {
      setConnected(true);
      setStatus(PREVIEW_STATUS);
      setReason('preview');
      setTitle('Dock icon preview');
      return undefined;
    }

    if (city && !picking) connect(city.value);
    return () => {
      clearTimeout(reconnectRef.current);
      if (wsRef.current) { wsRef.current.onclose = null; wsRef.current.close(); }
    };
  }, [city, picking, connect]);

  const selectCity = useCallback((c) => {
    localStorage.setItem('pakardot_city', JSON.stringify(c));
    setCity(c);
    setPicking(false);
    setStatus('unknown');
    setReason('');
    setLastChecked(null);
  }, []);

  const updateAction = useCallback(async () => {
    const updates = window.pakardotUpdates;
    if (!updates || !updateStatus) return;

    if (updateStatus.state === 'available') {
      setUpdateStatus((prev) => ({ ...prev, state: 'downloading', percent: 0 }));
      const next = await updates.download();
      if (next?.state && next.state !== 'downloading') setUpdateStatus(next);
      return;
    }

    if (updateStatus.state === 'downloaded') {
      await updates.install();
      return;
    }

    if (updateStatus.state === 'error') {
      const next = await updates.check();
      if (next?.state && next.state !== 'checking') setUpdateStatus(next);
    }
  }, [updateStatus]);

  const updateButton = (() => {
    if (!window.pakardotUpdates || !updateStatus) return null;

    if (updateStatus.state === 'available') {
      return {
        label: `Update ${updateStatus.version || ''}`.trim(),
        title: 'Download update',
        disabled: false,
      };
    }

    if (updateStatus.state === 'downloading') {
      return {
        label: `Updating ${updateStatus.percent || 0}%`,
        title: 'Downloading update',
        disabled: true,
      };
    }

    if (updateStatus.state === 'downloaded') {
      return {
        label: 'Restart to update',
        title: 'Install update and restart',
        disabled: false,
      };
    }

    if (updateStatus.state === 'error') {
      return {
        label: 'Retry update',
        title: updateStatus.message || 'Retry update check',
        disabled: false,
      };
    }

    return null;
  })();

  // ── City Picker screen ──────────────────────────────────────────────────────
  if (picking) {
    return (
      <CityPicker
        current={city}
        onSelect={selectCity}
        onCancel={city ? () => setPicking(false) : null}
      />
    );
  }

  // ── Main status screen ──────────────────────────────────────────────────────
  const cfg = STATUS[status] ?? STATUS.unknown;

  return (
    <div
      className={`app${cfg.flashBg ? ' flash-bg' : ''}`}
      style={{ '--bg-accent': cfg.bgAccent }}
    >
      {/* ── Top bar ─────────────────────────────────────────────────────────── */}
      <div className="top-bar">
        <button className="city-btn" onClick={() => setPicking(true)} aria-label="Change city">
          <span className="city-name">{city?.label_he || city?.label || ''}</span>
          <span className="city-change-hint">Change city</span>
          <span className={`conn-pip${connected ? ' on' : ''}`} title={connected ? 'Live' : 'Reconnecting…'} />
        </button>
        {wakeLockSupported && (
          <button
            className={`btn-wakelock${wakeLock ? ' active' : ''}`}
            onClick={() => (wakeLock ? releaseWL() : requestWL())}
            title={wakeLock ? 'Screen stay-on: ON — tap to disable' : 'Keep screen on'}
            aria-label="Toggle screen wake lock"
          >
            {wakeLock ? 'Stay-on ON' : 'Stay-on OFF'}
          </button>
        )}
        {updateButton && (
          <button
            className="btn-update"
            onClick={updateAction}
            title={updateButton.title}
            disabled={updateButton.disabled}
            aria-label={updateButton.title}
          >
            {updateButton.label}
          </button>
        )}
      </div>

      {/* ── Big dot ─────────────────────────────────────────────────────────── */}
      <div className="dot-stage">
        <div
          className={`dot${cfg.pulse > 0 ? ' pulse' : ''}`}
          style={{
            background: cfg.color,
            boxShadow: cfg.glow,
            '--pd': `${cfg.pulse}s`,
          }}
        />
      </div>

      {/* ── Status text ─────────────────────────────────────────────────────── */}
      <div className="status-area">
        <p className="s-he" dir="rtl">{cfg.labelHe}</p>
        <p className="s-en">{cfg.label}</p>
        {alertTitle && <p className="s-alert-title" dir="rtl">{alertTitle}</p>}
        {(cfg.desc || cfg.descHe) && (
          <p className="s-desc" dir="rtl">{cfg.descHe}</p>
        )}
        {status === 'yellow' && (
          <p className="s-hold" dir="rtl">אין טיימר - מחכים להודעת יציאה רשמית</p>
        )}
        <div className="live-meta">
          <span>{connected ? 'Live connection' : 'Reconnecting'}</span>
          <span>Poll: {Math.round(pollMs / 1000)}s</span>
          <span>Checked: {formatTime(lastChecked)}</span>
          {reason && <span>{reasonLabel(reason)}</span>}
        </div>
      </div>

      {/* ── Pikud HaOref branding ────────────────────────────────────────────── */}
      <p className="footer">פיקוד העורף · Pikud HaOref</p>
    </div>
  );
}
