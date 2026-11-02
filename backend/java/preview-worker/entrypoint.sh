#!/bin/sh
set -eu
# LibreOffice uses a separate unprivileged UID and cannot open network connections.
# The Java worker retains only its authenticated internal HTTP transport.
iptables -A OUTPUT -m owner --uid-owner 10002 -j REJECT
if [ -e /proc/sys/net/ipv6/conf/all/disable_ipv6 ] && [ "$(cat /proc/sys/net/ipv6/conf/all/disable_ipv6)" = "0" ]; then
  ip6tables -A OUTPUT -m owner --uid-owner 10002 -j REJECT
fi
mkdir -p "$PREVIEW_TEMP_DIR"
mkdir -p "$PREVIEW_TEMP_DIR/.native"
chmod 700 "$PREVIEW_TEMP_DIR/.native"
if [ "$#" -gt 0 ]; then exec "$@"; fi
exec java -Xms128m -Xmx8g -Dorg.sqlite.tmpdir="$PREVIEW_TEMP_DIR/.native" -jar /opt/preview/worker.jar
