#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")"
command -v node >/dev/null 2>&1 || { echo "Install Node.js 22.13 or newer: https://nodejs.org/"; exit 1; }
command -v npm >/dev/null 2>&1 || { echo "npm was not found. Reinstall Node.js."; exit 1; }
[ -d node_modules ] || npm ci
npm start
