#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "Installing backend dependencies..."
(cd "$ROOT_DIR/backend" && npm install)

echo "Installing frontend dependencies..."
(cd "$ROOT_DIR/frontend" && npm install)

echo "Building frontend..."
(cd "$ROOT_DIR/frontend" && npm run build)

echo "Production bootstrap complete."
