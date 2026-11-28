#!/bin/bash
set -euo pipefail
umask 077
s="$1"
cd -- "$s"
release="$2"
data="${3:-$release/data}"
export HOME="$s/home" XDG_CONFIG_HOME="$s/home/.config" XDG_CACHE_HOME="$s/home/.cache" XDG_DATA_HOME="$s/home/.local/share"
app_pid=''
tunnel_pid=''
stage=APPLICATION
mark() { printf '%s\n' "$1" > "$s/status.new"; mv -f -- "$s/status.new" "$s/status"; }
cleanup() {
  if [[ -n "$tunnel_pid" ]]; then kill -TERM "$tunnel_pid" 2>/dev/null || true; fi
  if [[ -n "$app_pid" ]]; then kill -TERM "$app_pid" 2>/dev/null || true; wait "$app_pid" || true; fi
  if [[ -n "$tunnel_pid" ]]; then wait "$tunnel_pid" || true; fi
}
trap cleanup EXIT
trap 'mark STOPPED; exit 0' TERM INT
trap 'mark "FAILED_$stage"' ERR
origin="$(cat "$s/named-origin")"
[[ "$origin" == https://nl6smkdc-18081.eun1.devtunnels.ms ]]
read -r tunnel_id < "$s/named-id"
[[ "$tunnel_id" == lean-center-qa.eun1 ]]
mark STARTING

status_code() {
  curl --silent --show-error --max-time 5 -H 'X-Tunnel-Skip-AntiPhishing-Page: true' \
    --output /dev/null --write-out '%{http_code}' "$1"
}
app_health() {
  curl --silent --show-error --fail --max-time 4 -H 'Accept: application/json' "$1/healthz" |
    "$release/.runtime/node" -e '
      const health=JSON.parse(require("node:fs").readFileSync(0,"utf8"));
      const source=require(process.argv[1]).sourceCommit;
      if(health.ok!==true||health.mode!=="LC8.1-QA"||health.complete!==false||
         health.sourceCommit!==source)process.exit(1);' "$release/tools/cloud-source.json"
}
guest_boundary() {
  local base="$1"
  [[ "$(status_code "$base/")" == 200 &&
     "$(status_code "$base/api/lc81/session")" == 401 &&
     "$(status_code "$base/api/lc81/admin")" == 401 &&
     "$(status_code "$base/editor/frame")" == 401 ]]
}
cd "$release"
env -i PATH=/usr/bin:/bin LC81_QA=1 LC81_LOOPBACK_ONLY=1 LC81_DATA_DIR="$data" \
  LC81_ORIGIN="$origin" PORT=18081 "$release/.runtime/node" server/lc81-main.mjs > "$s/app.log" 2>&1 &
app_pid=$!
ready=0
for attempt in {1..20}; do
  kill -0 "$app_pid" || { mark FAILED_APPLICATION; exit 1; }
  if app_health http://127.0.0.1:18081; then ready=1; break; fi
  sleep 1
done
[[ "$ready" == 1 ]] || { mark FAILED_APPLICATION; exit 1; }
stage=GUEST_ACCESS
guest_boundary http://127.0.0.1:18081 || { mark FAILED_GUEST_ACCESS; exit 1; }

stage=TUNNEL
cd "$s"
"$s/devtunnel" host "$tunnel_id" > "$s/tunnel.log" 2>&1 &
tunnel_pid=$!
relay_ready=0
for attempt in {1..28}; do
  kill -0 "$app_pid" || { mark FAILED_APPLICATION; exit 1; }
  kill -0 "$tunnel_pid" || { mark FAILED_TUNNEL; exit 1; }
  if grep -qi 'ready to accept connections' "$s/tunnel.log"; then
    url="$(grep -m1 -oE 'https://[a-z0-9-]+-18081\.[a-z0-9-]+\.devtunnels\.ms' "$s/tunnel.log" || true)"
    [[ "$url" == "$origin" ]] || { mark FAILED_ORIGIN_CHANGED; exit 1; }
    relay_ready=1
    break
  fi
  sleep 1
done
[[ "$relay_ready" == 1 ]] || { mark FAILED_TUNNEL; exit 1; }

stage=GUEST_ACCESS
for attempt in {1..7}; do
  if app_health "$origin" && guest_boundary "$origin"; then
    printf '%s\n' "$origin" > "$s/origin"
    mark READY
    wait -n "$app_pid" "$tunnel_pid" || true
    mark STOPPED
    exit 0
  fi
  sleep 2
done
mark FAILED_GUEST_ACCESS
exit 1
