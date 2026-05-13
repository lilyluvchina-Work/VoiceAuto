#!/usr/bin/env bash
set -euo pipefail

OUTPUT_ROOT="${1:-$HOME/voiceauto-deploy-bundles}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
BUNDLE_DIR="$OUTPUT_ROOT/voiceauto-$TIMESTAMP"

echo "[1/5] Building project at $PROJECT_ROOT"
cd "$PROJECT_ROOT"
npm run build

echo "[2/5] Creating external bundle directory: $BUNDLE_DIR"
mkdir -p "$BUNDLE_DIR"

echo "[3/5] Copying dist output"
mkdir -p "$BUNDLE_DIR/dist"
cp -R "$PROJECT_ROOT/dist/." "$BUNDLE_DIR/dist/"

echo "[4/5] Copying reusable deployment assets"
mkdir -p "$BUNDLE_DIR/deploy"
cp -R "$PROJECT_ROOT/deploy/nginx" "$BUNDLE_DIR/deploy/"
cp -R "$PROJECT_ROOT/deploy/docker" "$BUNDLE_DIR/deploy/"
cp "$PROJECT_ROOT/docx/SERVER_DEPLOYMENT_GUIDE.md" "$BUNDLE_DIR/"

echo "[5/5] Bundle ready"
echo "Output: $BUNDLE_DIR"
