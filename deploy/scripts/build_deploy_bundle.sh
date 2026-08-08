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

echo "[4/6] Copying backend server"
mkdir -p "$BUNDLE_DIR/src"
cp -R "$PROJECT_ROOT/server" "$BUNDLE_DIR/server"
cp -R "$PROJECT_ROOT/scripts" "$BUNDLE_DIR/scripts"
cp -R "$PROJECT_ROOT/src/config" "$BUNDLE_DIR/src/config"
cp "$PROJECT_ROOT/package.json" "$BUNDLE_DIR/"
cp "$PROJECT_ROOT/package-lock.json" "$BUNDLE_DIR/"

echo "[5/6] Copying reusable deployment assets"
mkdir -p "$BUNDLE_DIR/deploy"
cp -R "$PROJECT_ROOT/deploy/nginx" "$BUNDLE_DIR/deploy/"
cp -R "$PROJECT_ROOT/deploy/docker" "$BUNDLE_DIR/deploy/"
cp "$PROJECT_ROOT/docs/deployment/server-deployment-guide.md" "$BUNDLE_DIR/"

echo "[6/6] Bundle ready"
echo "Output: $BUNDLE_DIR"
