#!/bin/sh
# Display :0 on TCP 6000 for the api container, a window manager so the recording window can be
# moved and focused, and the same screen over VNC and noVNC for the tester's browser.
set -e

Xvfb :0 -screen 0 "${DISPLAY_SIZE:-1440x900x24}" -listen tcp -ac -nolisten unix &
export DISPLAY=127.0.0.1:0

# Xvfb takes a moment to accept connections.
i=0
until xdpyinfo >/dev/null 2>&1 || [ $i -ge 50 ]; do i=$((i + 1)); sleep 0.2; done

openbox &
x11vnc -display "$DISPLAY" -forever -shared -nopw -quiet -rfbport 5900 &
exec websockify --web /usr/share/novnc 6080 localhost:5900
