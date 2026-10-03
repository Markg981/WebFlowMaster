#!/bin/sh
set -eu
node /opt/policy.mjs /tmp/squid.conf
# Parse silently: diagnostics can contain request data after startup; access
# logs deliberately contain only method/status and the source IP.
squid -k parse -f /tmp/squid.conf >/dev/null 2>&1 || { echo 'Proxy configuration validation failed' >&2; exit 1; }
exec squid -N -f /tmp/squid.conf
