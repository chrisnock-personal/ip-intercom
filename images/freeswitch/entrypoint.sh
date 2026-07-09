#!/bin/sh
# Substitutes the intercom SIP profile's bind IP with an explicit,
# operator-configured address (FREESWITCH_BIND_IP) rather than trusting
# FreeSWITCH's own $${local_ip_v4} auto-detection — see the comment in
# sip_profiles/intercom.xml for why (multi-homed host, wrong NIC picked).
set -e
: "${FREESWITCH_BIND_IP:?FREESWITCH_BIND_IP must be set — the host's routed/LAN IP, same as RTPENGINE_PUBLIC_IP}"

sed -i "s/__BIND_IP__/${FREESWITCH_BIND_IP}/g" /usr/local/freeswitch/conf/sip_profiles/intercom.xml

exec /usr/local/freeswitch/bin/freeswitch -nonat -nc -nf
