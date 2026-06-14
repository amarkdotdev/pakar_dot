# PakarDot

PakarDot is a standalone macOS alert-status app for Israeli cities served by Pikud HaOref. It defaults to Ma'aleh Edomim (`מעלה אדומים`), but you can choose any city from the official Pikud HaOref city list. It shows a large overnight-friendly status display:

- **Green**: no active local alert known.
- **Yellow**: stay in the mamad / protected room until Pikud HaOref sends an explicit all-clear/update.
- **Red**: active official alert for the selected city.

The app runs as an Electron desktop app, starts a local backend on `127.0.0.1`, polls Pikud HaOref every 5 seconds, and prevents display sleep while running.

## One-Command Mac Install

On an Intel or Apple Silicon Mac with Node.js 20+ installed:

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/amarkdotdev/pakar_dot/main/scripts/install-mac.sh)"
```

The installer clones the repo, builds the correct app for your Mac, copies `PakarDot.app` to `/Applications`, and launches it.

If you do not have Node.js, install the current LTS from [nodejs.org](https://nodejs.org/) first.

## Build Manually

```bash
git clone git@github.com:amarkdotdev/pakar_dot.git
cd pakar_dot
npm install
npm run dist
open release/mac/PakarDot.app
```

On Apple Silicon, the built app is at `release/mac-arm64/PakarDot.app`.

## How It Works

- `backend/server.js` polls:
  - `https://www.oref.org.il/warningMessages/alert/Alerts.json`
  - `https://www.oref.org.il/warningMessages/alert/History/AlertsHistory.json`
- The frontend subscribes over a local WebSocket.
- Cities are loaded from `pikud-haoref-api/cities.json`, and the app subscribes to the selected city's official alert value. The default city is `מעלה אדומים`.
- Yellow does **not** use a fixed timer. It remains yellow after a warning/alert until the feed contains an official all-clear style update such as `האירוע הסתיים`, `יכולים לצאת`, or `ניתן לצאת`.

## Safety Note

This app is a supplemental dashboard, not an official warning system. The Pikud HaOref JSON endpoints used here are public-facing but not a documented API with a formal SLA. Keep the official Pikud HaOref app, sirens, radio, and official instructions as the source of truth during emergencies.

## Development

Run the desktop app from source:

```bash
npm install
npm start
```

Run only the backend:

```bash
cd backend
npm install
npm start
```

Run only the frontend dev server:

```bash
cd frontend
npm install
npm run dev
```

## Repository Hygiene

Generated files are intentionally ignored:

- `node_modules/`
- `frontend/dist/`
- `release/`
- `.env*`
- OS/editor junk such as `.DS_Store`

No API keys or secrets are required.
