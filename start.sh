#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"

# Install dependencies if node_modules is missing
if [ ! -d "node_modules" ]; then
  echo ""
  echo " Installing dependencies (first run)..."
  npm install
fi

echo ""
echo " Starting Truth or Dare 2.0..."
echo ""
node server.js
