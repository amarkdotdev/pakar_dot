#!/usr/bin/env bash
set -euo pipefail

REPO_URL="${PAKARDOT_REPO_URL:-https://github.com/amarkdotdev/pakar_dot.git}"
WORKDIR="$(mktemp -d "${TMPDIR:-/tmp}/pakardot-install.XXXXXX")"
APP_NAME="PakarDot.app"
APP_DEST="/Applications/${APP_NAME}"

cleanup() {
  rm -rf "${WORKDIR}"
}
trap cleanup EXIT

if ! command -v git >/dev/null 2>&1; then
  echo "git is required. Install Xcode Command Line Tools first: xcode-select --install" >&2
  exit 1
fi

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  echo "Node.js and npm are required. Install Node.js 20+ from https://nodejs.org/ and run this again." >&2
  exit 1
fi

NODE_MAJOR="$(node -p "process.versions.node.split('.')[0]")"
if [ "${NODE_MAJOR}" -lt 20 ]; then
  echo "Node.js 20+ is required. Current version: $(node -v)" >&2
  exit 1
fi

echo "Cloning PakarDot..."
git clone --depth 1 "${REPO_URL}" "${WORKDIR}/pakar_dot"
cd "${WORKDIR}/pakar_dot"

echo "Installing dependencies..."
npm install

echo "Building frontend, backend, and icon..."
npm run prebuild

ARCH="$(uname -m)"
if [ "${ARCH}" = "arm64" ]; then
  echo "Building Apple Silicon app..."
  npm run build:mac-arm
  BUILT_APP="${PWD}/release/mac-arm64/${APP_NAME}"
else
  echo "Building Intel app..."
  npm run build:mac-intel
  BUILT_APP="${PWD}/release/mac/${APP_NAME}"
fi

if [ ! -d "${BUILT_APP}" ]; then
  echo "Build did not create ${APP_NAME}." >&2
  exit 1
fi

echo "Installing to ${APP_DEST}..."
rm -rf "${APP_DEST}"
cp -R "${BUILT_APP}" "${APP_DEST}"
xattr -dr com.apple.quarantine "${APP_DEST}" 2>/dev/null || true

echo "Launching PakarDot..."
open "${APP_DEST}"

echo "Done. PakarDot is installed at ${APP_DEST}"

