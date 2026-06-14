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
    labelHe: 'צהוב - להישאר בממ"ד',
    label: 'YELLOW - STAY IN MAMAD',
    descHe: 'ממתינים לעדכון רשמי מפיקוד העורף שמותר לצאת',
    desc: 'Stay in the protected room until the official all-clear',
    pulse: 1.6,
    flashBg: false,
  },
  red: {
    color: '#ff1744',
    glow: '0 0 100px #ff174480, 0 0 200px #ff174430',
    bgAccent: '#1a0005',
    labelHe: 'אזעקה — היכנסו למרחב המוגן',
    label: 'SIREN — ENTER SHELTER',
    descHe: 'היכנסו מיד למרחב המוגן (ממ"ד)',
    desc: 'Go to your mammad immediately',
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
