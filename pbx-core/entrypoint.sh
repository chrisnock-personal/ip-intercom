#!/usr/bin/env bash
set -euo pipefail

# Start the drachtio SIP server (SofiaSIP engine). It exposes the admin/control
# socket on :9022 that our TS app connects to. All SIP logic stays in the app.
# WS on :8088 matches container-sip-endpoint's default register() target
# (ws://<server>:8088/ws). The endpoint's wsPort/wsPath are overridable in
# /api/register if you prefer a different port/path.
/usr/local/bin/drachtio --daemon \
                        --contact "sip:*;transport=udp,tcp" \
                        --contact "sip:*:8088;transport=ws" \
                        --loglevel info --sofia-loglevel 2 \
                        --port 9022 --secret "${DRACHTIO_SECRET:-cymru}"

# Give the server a moment to open its control socket, then run the app.
sleep 1
exec node dist/index.js
