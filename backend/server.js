const express = require('express');
const http = require('http');
const { WebSocketServer, WebSocket } = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

// ── Official city list — 1450 districts from Pikud HaOref ─────────────────────
// Sourced from the pikud-haoref-api npm package (matches alert data field exactly)
const RAW_CITIES = require('pikud-haoref-api/cities.json');
const ALL_CITIES = RAW_CITIES
  .filter(c => c.value && c.value !== 'all' && c.name)
  .map(c => ({
    value:    c.value,
    label_he: c.name,
    label:    c.name_en || c.name,
    zone_he:  c.zone    || '',
    zone_en:  c.zone_en || '',
    countdown: c.countdown ?? 0,
  }))
  .sort((a, b) => a.label_he.localeCompare(b.label_he, 'he'));

// ── Pikud HaOref endpoints ────────────────────────────────────────────────────
const ALERTS_URL = 'https://www.oref.org.il/warningMessages/alert/Alerts.json';
const ALERTS_HISTORY_URL = 'https://www.oref.org.il/warningMessages/alert/History/AlertsHistory.json';
const POLL_MS = parseInt(process.env.PAKARDOT_POLL_MS ?? '5000', 10);
const OREF_HEADERS  = {
  'Pragma': 'no-cache',
  'Cache-Control': 'max-age=0',
  'X-Requested-With': 'XMLHttpRequest',
  'Referer': 'https://www.oref.org.il/11226-he/pakar.aspx',
  'Accept': 'application/json, text/javascript, */*; q=0.01',
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
};

const ALL_CLEAR_RE = /האירוע הסתיים|יכולים לצאת|ניתן לצאת|אפשר לצאת|הסכנה.*חלפה|danger.*passed|event.*ended/i;
const WARNING_RE = /התקרבו|זוהה שיגור|התרעות עלולות|הישארו בקרבת|קרוב למרחב מוגן/i;

// ── State ─────────────────────────────────────────────────────────────────────
let lastAlerts   = null;
let lastHistory = [];
let lastCheckedAt = null;
let pollTimer = null;
const cityStates = new Map(); // cityValue → latest known local state while app is running
const subscribers = new Map(); // cityValue → Set<WebSocket>

// ── Helpers ───────────────────────────────────────────────────────────────────
async function fetchJSON(url) {
  const bustedUrl = `${url}?_=${Date.now()}`;
  const res = await fetch(bustedUrl, { headers: OREF_HEADERS, cache: 'no-store' });
  const buffer = Buffer.from(await res.arrayBuffer());
  const text = decodeOrefJSON(buffer).trim();
  if (!text || text === 'null' || text === '""' || text === '[]') return null;
  return JSON.parse(text);
}

function decodeOrefJSON(buffer) {
  if (buffer.length > 1 && buffer[0] === 255 && buffer[1] === 254) {
    return buffer.slice(2).toString('utf16le');
  }
  return buffer.toString('utf8').replace(/^\uFEFF/, '');
}

function cityIsInAlert(cityValue, alerts) {
  return alerts?.data?.some(area => area === cityValue);
}

function historyForCity(cityValue, history) {
  if (!Array.isArray(history)) return [];
  return history
    .filter(item => item?.data?.trim() === cityValue)
    .sort((a, b) => new Date(b.alertDate).getTime() - new Date(a.alertDate).getTime());
}

function knownState(cityValue) {
  return cityStates.get(cityValue) ?? {
    status: 'green',
    reason: 'clear',
    alertTitle: null,
    eventAt: null,
  };
}

function remember(cityValue, statusInfo) {
  cityStates.set(cityValue, statusInfo);
  return statusInfo;
}

function classifyEvent({ cityValue, category, title, eventAt }) {
  const cat = parseInt(category, 10);
  const alertTitle = title ?? null;
  const text = alertTitle ?? '';
  const recordedAt = eventAt ?? Date.now();

  if (ALL_CLEAR_RE.test(text)) {
    return remember(cityValue, {
      status: 'green',
      reason: 'oref_all_clear',
      alertTitle,
      eventAt: recordedAt,
    });
  }

  if (WARNING_RE.test(text) || cat === 10 || cat === 14) {
    return remember(cityValue, {
      status: 'yellow',
      reason: 'oref_warning',
      alertTitle,
      eventAt: recordedAt,
    });
  }

  return remember(cityValue, {
    status: 'red',
    reason: 'active_alert',
    alertTitle,
    eventAt: recordedAt,
  });
}

function computeStatus(cityValue, alerts, history) {
  const previous = knownState(cityValue);

  if (cityIsInAlert(cityValue, alerts)) {
    return classifyEvent({
      cityValue,
      category: alerts.cat,
      title: alerts.title,
    });
  }

  const [latestHistory] = historyForCity(cityValue, history);
  if (latestHistory) {
    const latestAt = new Date(latestHistory.alertDate).getTime();
    if (!previous.eventAt || latestAt > previous.eventAt) {
      return classifyEvent({
        cityValue,
        category: latestHistory.category,
        title: latestHistory.title,
        eventAt: latestAt,
      });
    }
  }

  if (!alerts?.data?.length) {
    if (previous.status === 'red') {
      return {
        ...previous,
        status: 'red',
        reason: 'waiting_oref_all_clear',
      };
    }
    if (previous.status === 'yellow') {
      return {
        ...previous,
        status: 'yellow',
        reason: 'waiting_oref_all_clear',
      };
    }
    return previous;
  }

  return previous;
}

function statusMessage(cityValue, statusInfo, alertTitle) {
  return JSON.stringify({
    type: 'status',
    city: cityValue,
    status: statusInfo.status,
    reason: statusInfo.reason,
    alertTitle: statusInfo.alertTitle ?? alertTitle ?? null,
    eventAt: statusInfo.eventAt ?? null,
    lastCheckedAt,
    pollMs: POLL_MS,
  });
}

function broadcast(cityValue, statusInfo, alertTitle) {
  const clients = subscribers.get(cityValue);
  if (!clients?.size) return;
  const msg = statusMessage(cityValue, statusInfo, alertTitle);
  for (const ws of clients) {
    if (ws.readyState === WebSocket.OPEN) ws.send(msg);
  }
}

// ── Polling loop ──────────────────────────────────────────────────────────────
async function poll() {
  try {
    const alerts = await fetchJSON(ALERTS_URL);
    const history = await fetchJSON(ALERTS_HISTORY_URL);
    lastAlerts = alerts;
    lastHistory = Array.isArray(history) ? history : [];
    lastCheckedAt = Date.now();
    for (const [city] of subscribers) {
      const statusInfo = computeStatus(city, alerts, lastHistory);
      broadcast(city, statusInfo, alerts?.title);
    }
  } catch (e) {
    console.error('Poll error:', e.message);
    for (const [city] of subscribers) {
      broadcast(city, { status: 'unknown', reason: 'poll_error' }, null);
    }
  }
}

function startPolling() {
  if (pollTimer) return;
  console.log(`✓ ${ALL_CITIES.length} cities loaded from Pikud HaOref database`);
  console.log(`✓ Polling Pikud HaOref every ${POLL_MS / 1000}s`);
  pollTimer = setInterval(poll, POLL_MS);
  poll();
}

// ── WebSocket ─────────────────────────────────────────────────────────────────
wss.on('connection', ws => {
  let myCity = null;

  ws.on('message', raw => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.type !== 'subscribe' || !msg.city) return;

      // Unsubscribe old city
      if (myCity) {
        const set = subscribers.get(myCity);
        if (set) { set.delete(ws); if (!set.size) subscribers.delete(myCity); }
      }

      // Subscribe new city
      myCity = msg.city;
      if (!subscribers.has(myCity)) subscribers.set(myCity, new Set());
      subscribers.get(myCity).add(ws);

      // Immediately send current status
      const statusInfo = computeStatus(myCity, lastAlerts, lastHistory);
      ws.send(statusMessage(myCity, statusInfo, lastAlerts?.title));
    } catch { /* ignore malformed messages */ }
  });

  ws.on('close', () => {
    if (!myCity) return;
    const set = subscribers.get(myCity);
    if (set) { set.delete(ws); if (!set.size) subscribers.delete(myCity); }
  });

  ws.on('error', () => ws.terminate());
});

// ── REST API ──────────────────────────────────────────────────────────────────
app.get('/api/cities', (_req, res) => {
  res.json(ALL_CITIES);
});

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    subscribers: subscribers.size,
    pollMs: POLL_MS,
    lastCheckedAt,
  });
});

// Serve PWA static files
const DIST = process.env.PAKARDOT_DIST || path.join(__dirname, '..', 'frontend', 'dist');
app.use(express.static(DIST));
app.get('*', (_req, res) => res.sendFile(path.join(DIST, 'index.html')));

// ── Startup ──────────────────────────────────────────────────────────────────
// Export `start()` so Electron / other embedders can boot the server in-process
// on a chosen host:port. Run as CLI (`node server.js`) → bind 0.0.0.0:3000.
function start({ port = parseInt(process.env.PORT ?? '3000', 10), host = '0.0.0.0' } = {}) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    startPolling();
    server.listen(port, host, () => {
      const actualPort = server.address().port;
      console.log(`PakarDot listening on ${host}:${actualPort}`);
      resolve({ port: actualPort, host });
    });
  });
}

if (require.main === module) start();

module.exports = { start, computeStatus, cityStates };
