#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"

ARCH=$(uname -m)
if [ "$ARCH" = "arm64" ] && [ -f "./node-arm64" ]; then
  NODE="./node-arm64"
  chmod +x "./node-arm64"
elif [ "$ARCH" = "x86_64" ] && [ -f "./node-x64" ]; then
  NODE="./node-x64"
  chmod +x "./node-x64"
else
  NODE="node"
fi

if [ ! -d "node_modules" ]; then
  echo ""
  echo " Installing dependencies... (first run only)"
  echo ""
  npm install
  echo ""
fi

echo ""
echo " Starting Truth or Dare 2.0..."
echo ""
"$NODE" server.js
