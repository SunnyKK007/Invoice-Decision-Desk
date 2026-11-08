#!/bin/bash
# Starts the app on your computer with the real Gemini second reader.
# It asks for your Gemini API key (typing is hidden), then runs the server.
# Get a free key at https://aistudio.google.com  ->  "Get API key".

cd "$(dirname "$0")" || exit 1

if [ -z "$GEMINI_API_KEY" ]; then
  printf "Paste your Gemini API key and press Enter (nothing will show as you paste): "
  read -rs GEMINI_API_KEY
  echo
fi
if [ -z "$GEMINI_API_KEY" ]; then
  echo "No key entered. Starting without it, so the app will run on rules only."
fi
export GEMINI_API_KEY

echo "Open http://localhost:8767 in your browser. Press Ctrl+C here to stop."
exec node tools/dev_server.js
