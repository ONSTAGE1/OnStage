#!/bin/bash
# OnStage Worship - double-click to start on macOS.
# Serves the app on http://localhost:8765 (needed for microphone access) and
# opens it in its own Google Chrome / Microsoft Edge app window.
cd "$(dirname "$0")" || exit 1
PORT=8765
URL="http://localhost:$PORT/index.html"

open_app() {
  if [ -d "/Applications/Google Chrome.app" ]; then
    open -na "Google Chrome" --args --app="$URL"
  elif [ -d "/Applications/Microsoft Edge.app" ]; then
    open -na "Microsoft Edge" --args --app="$URL"
  else
    echo "Tip: install Google Chrome for the AI microphone feature."
    open "$URL"
  fi
}

if curl -s -o /dev/null "$URL"; then open_app; exit 0; fi

if command -v python3 >/dev/null 2>&1 && python3 -c "" >/dev/null 2>&1; then
  python3 -m http.server "$PORT" --bind 127.0.0.1 >/dev/null 2>&1 &
elif command -v ruby >/dev/null 2>&1; then
  ruby -run -e httpd . -p "$PORT" -b 127.0.0.1 >/dev/null 2>&1 &
else
  echo "Could not find Python 3 or Ruby to run the local server."
  echo "Install Python 3 from https://www.python.org/downloads/ and try again."
  read -r -p "Press Enter to close"
  exit 1
fi
SERVER=$!
trap 'kill $SERVER 2>/dev/null' EXIT
for _ in 1 2 3 4 5 6 7 8 9 10; do curl -s -o /dev/null "$URL" && break; sleep 0.5; done
open_app
echo ""
echo "  OnStage Worship is running at http://localhost:$PORT"
echo "  Keep this window open while you use the app. Close it to stop."
echo ""
wait $SERVER
