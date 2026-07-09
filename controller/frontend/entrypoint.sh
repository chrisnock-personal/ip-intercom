#!/bin/sh
# Generates a self-signed TLS cert on first start (only — /etc/nginx/tls is
# a mounted volume, so a redeploy doesn't regenerate it and force a fresh
# browser trust-exception every time). Lab-appropriate: a real domain +
# Let's Encrypt isn't an option for a private/routed LAN deployment with no
# public DNS.
set -e

CERT_DIR=/etc/nginx/tls
CERT_FILE="$CERT_DIR/cert.pem"
KEY_FILE="$CERT_DIR/key.pem"

if [ ! -f "$CERT_FILE" ] || [ ! -f "$KEY_FILE" ]; then
  echo "[entrypoint] No TLS cert found — generating a self-signed one..."
  mkdir -p "$CERT_DIR"
  SAN="DNS:localhost,IP:127.0.0.1"
  if [ -n "$CERT_SAN_IP" ]; then SAN="$SAN,IP:$CERT_SAN_IP"; fi
  openssl req -x509 -nodes -newkey rsa:2048 -days 3650 \
    -keyout "$KEY_FILE" -out "$CERT_FILE" \
    -subj "/CN=ip-intercom.local" \
    -addext "subjectAltName=$SAN"
  echo "[entrypoint] Cert generated (SAN: $SAN)"
fi

exec nginx -g 'daemon off;'
