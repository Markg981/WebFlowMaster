#!/bin/sh
# Display :0 on TCP 6000 for the api container, a window manager so the recording window can be
# moved and focused, and the same screen over VNC and noVNC for the tester's browser.
set -e

# Xvfb leaves /tmp/.X0-lock behind, and /tmp survives a restart of the container (Docker Desktop
# restarting is enough): the next Xvfb then refuses with "Server is already active for display 0",
# while noVNC still answers on 6080 with nothing behind it and the recording cannot open. Nothing
# else runs in this container, so a lock found here is always stale.
rm -f /tmp/.X0-lock /tmp/.X11-unix/X0

Xvfb :0 -screen 0 "${DISPLAY_SIZE:-1440x900x24}" -listen tcp -ac -nolisten unix &
export DISPLAY=127.0.0.1:0

# Xvfb takes a moment to accept connections.
i=0
until xdpyinfo >/dev/null 2>&1; do
  i=$((i + 1))
  if [ $i -ge 50 ]; then
    # Stop rather than serve an empty screen: the container restarts and tries again.
    echo "Xvfb did not start on display :0" >&2
    exit 1
  fi
  sleep 0.2
done

openbox &
# -noshm: MIT-SHM is not available across the container boundary, and without it x11vnc dies
# on the first frame and noVNC only says "Failed to connect".
x11vnc -display "$DISPLAY" -forever -shared -nopw -noshm -quiet -rfbport 5900 &
exec websockify --web /usr/share/novnc 6080 localhost:5900
