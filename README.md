# PakarDot

PakarDot is a standalone macOS alert-status app for Israeli cities served by Pikud HaOref. It defaults to Ma'aleh Edomim (`מעלה אדומים`), but you can choose any city from the official Pikud HaOref city list. It shows a large overnight-friendly status display:

- **Green**: no active local alert known.
- **Yellow**: stay in the mamad / protected room until Pikud HaOref sends an explicit all-clear/update.
- **Red**: active official alert for the selected city.

The app runs as an Electron desktop app, starts a local backend on `127.0.0.1`, polls Pikud HaOref every 5 seconds, and prevents display sleep while running.

## Install on Mac

Download the latest `.dmg` from [GitHub Releases](https://github.com/amarkdotdev/pakar_dot/releases), open it, and drag `PakarDot.app` into the `Applications` shortcut.

That is the recommended install path for normal users. It works on Intel and Apple Silicon Macs when both release artifacts are published.

## Updates

PakarDot checks GitHub Releases for app updates when it launches. When an update is available, a blue update button appears in the app:

- **Update** downloads the new version.
- **Restart to update** installs it in place and relaunches the app.

Important macOS detail: automatic in-place updates require a properly signed macOS app. For public releases, build with an Apple Developer ID certificate and notarize the app. Unsigned local builds are useful for testing, but they are not a reliable production update path.

## Source Install

On an Intel or Apple Silicon Mac with Node.js 20+ installed:

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/amarkdotdev/pakar_dot/main/scripts/install-mac.sh)"
```

The installer clones the repo, builds the correct app for your Mac, copies `PakarDot.app` to `/Applications`, and launches it. This is mainly for development or testing before a release DMG exists.

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

## Publishing a Release

1. Bump `version` in `package.json`.
2. Commit the change.
3. Create and push a tag:

```bash
git tag v1.0.1
git push origin main v1.0.1
```

GitHub Actions builds and uploads the macOS DMG/ZIP artifacts and update metadata.

For production-grade updates, configure these repository secrets before publishing:

- `MAC_CSC_LINK`: base64-encoded Apple Developer ID Application certificate (`.p12`).
- `MAC_CSC_KEY_PASSWORD`: certificate password.
- `APPLE_ID`: Apple ID used for notarization.
- `APPLE_APP_SPECIFIC_PASSWORD`: app-specific password for that Apple ID.
- `APPLE_TEAM_ID`: Apple developer team ID.

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
