#!/bin/sh
# Environment values are JSON data, never shell code or sourced files.
set -eu
umask 077
: "${XRAY_US_ADDRESS:?XRAY_US_ADDRESS is required}"
: "${XRAY_CLIENT_UUID:?XRAY_CLIENT_UUID is required}"
: "${XRAY_REALITY_PUBLIC_KEY:?XRAY_REALITY_PUBLIC_KEY is required}"
: "${XRAY_REALITY_SHORT_ID:?XRAY_REALITY_SHORT_ID is required}"
jq -en \
  --arg address "$XRAY_US_ADDRESS" \
  --arg port "${XRAY_US_PORT:-443}" \
  --arg id "$XRAY_CLIENT_UUID" \
  --arg key "$XRAY_REALITY_PUBLIC_KEY" \
  --arg sid "$XRAY_REALITY_SHORT_ID" \
  --arg sni "${XRAY_REALITY_SERVER_NAME:-www.microsoft.com}" '
  if ($id | test("^[a-fA-F0-9]{8}(-[a-fA-F0-9]{4}){3}-[a-fA-F0-9]{12}$"))
     and ($key | test("^[A-Za-z0-9_-]{43}$"))
     and ($sid | test("^([a-fA-F0-9]{2}){1,8}$"))
     and ($port | test("^[0-9]{1,5}$"))
     and (($port | tonumber) >= 1 and ($port | tonumber) <= 65535)
  then {
    log: {loglevel: "warning"},
    inbounds: [{tag: "telegram", listen: "0.0.0.0", port: 18080, protocol: "http", settings: {}}],
    outbounds: [{tag: "us-exit", protocol: "vless",
      settings: {address: $address, port: ($port | tonumber), id: $id, encryption: "none", flow: "xtls-rprx-vision"},
      streamSettings: {network: "raw", security: "reality", realitySettings: {
        serverName: $sni, fingerprint: "chrome", password: $key, shortId: $sid
      }}
    }]
  } else error("Invalid XRAY environment configuration (values withheld)") end
' > /tmp/xray.json
xray run -test -config /tmp/xray.json >/dev/null
exec xray run -config /tmp/xray.json
