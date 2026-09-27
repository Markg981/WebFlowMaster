# A screen for the collaudo stack, seen from the tester's browser.
#
# Recording a test (WEB-11) and saving the login of an environment (ENV-04) open a real browser
# window on the machine of the server, and a container has no screen: the product then says it
# cannot record, which is right for a server and left those two cases blocked in collaudo.
#
# This is a virtual display (Xvfb) that the api container draws on over X11 — DISPLAY=display:0 —
# and that noVNC shows at http://localhost:6080/vnc.html. The recording window appears there and
# is used with the mouse and keyboard like any other.
#
# For the test installation only: X access control is off (-ac) and VNC has no password, on a
# port bound to the loopback interface.
FROM debian:bookworm-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends xvfb x11-utils x11vnc novnc websockify openbox \
 && rm -rf /var/lib/apt/lists/* \
 && ln -s /usr/share/novnc/vnc.html /usr/share/novnc/index.html

COPY start.sh /usr/local/bin/start-display
RUN sed -i 's/\r$//' /usr/local/bin/start-display && chmod +x /usr/local/bin/start-display

EXPOSE 6000 6080
CMD ["/usr/local/bin/start-display"]
