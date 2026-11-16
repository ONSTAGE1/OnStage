#!/bin/bash
# OnStage Worship - double-click to start on macOS.
# Opens the app in its own Google Chrome (or Microsoft Edge) window.
cd "$(dirname "$0")" || exit 1
URL="file://$PWD/index.html"

if [ -d "/Applications/Google Chrome.app" ] || [ -d "$HOME/Applications/Google Chrome.app" ]; then
  open -na "Google Chrome" --args --app="$URL"
elif [ -d "/Applications/Microsoft Edge.app" ]; then
  open -na "Microsoft Edge" --args --app="$URL"
else
  echo "Google Chrome is needed for the AI microphone feature:"
  echo "https://www.google.com/chrome/"
  open "$PWD/index.html"
fi
