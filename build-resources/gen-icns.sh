#!/usr/bin/env bash
# Generates icon.icns from a 1024×1024 PNG using macOS native tools.
set -euo pipefail

cd "$(dirname "$0")"
SRC="../frontend/public/icon-1024.png"
ICONSET="icon.iconset"
OUT="icon.icns"

if [[ ! -f "$SRC" ]]; then
  echo "Source PNG not found at $SRC. Run 'npm run build:frontend' first."
  exit 1
fi

rm -rf "$ICONSET" "$OUT"
mkdir -p "$ICONSET"

# Apple's required iconset sizes
sips -z 16   16   "$SRC" --out "$ICONSET/icon_16x16.png"      >/dev/null
sips -z 32   32   "$SRC" --out "$ICONSET/icon_16x16@2x.png"   >/dev/null
sips -z 32   32   "$SRC" --out "$ICONSET/icon_32x32.png"      >/dev/null
sips -z 64   64   "$SRC" --out "$ICONSET/icon_32x32@2x.png"   >/dev/null
sips -z 128  128  "$SRC" --out "$ICONSET/icon_128x128.png"    >/dev/null
sips -z 256  256  "$SRC" --out "$ICONSET/icon_128x128@2x.png" >/dev/null
sips -z 256  256  "$SRC" --out "$ICONSET/icon_256x256.png"    >/dev/null
sips -z 512  512  "$SRC" --out "$ICONSET/icon_256x256@2x.png" >/dev/null
sips -z 512  512  "$SRC" --out "$ICONSET/icon_512x512.png"    >/dev/null
cp "$SRC"             "$ICONSET/icon_512x512@2x.png"

iconutil -c icns "$ICONSET" -o "$OUT"
rm -rf "$ICONSET"
echo "✓ $OUT generated"
