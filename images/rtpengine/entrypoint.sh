#!/bin/sh
set -e
: "${RTPENGINE_PUBLIC_IP:?set RTPENGINE_PUBLIC_IP to this host's routed/LAN IP}"

# --table=-1  -> userspace-only forwarding (no kernel module needed)
# --interface -> the address rtpengine advertises + anchors media on
exec rtpengine \
  --foreground --log-stderr --log-level="${RTPENGINE_LOG_LEVEL:-6}" \
  --table=-1 \
  --interface="${RTPENGINE_PUBLIC_IP}" \
  --listen-ng=127.0.0.1:"${RTPENGINE_NG_PORT:-22222}" \
  --port-min="${RTPENGINE_PORT_MIN:-30000}" \
  --port-max="${RTPENGINE_PORT_MAX:-40000}"
