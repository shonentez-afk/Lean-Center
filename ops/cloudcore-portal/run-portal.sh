#!/bin/bash
set -euo pipefail
umask 077
[[ "$(id -un)" == lean-deploy && "$(id -u)" != 0 ]]
portal="$(cd -- "$(dirname -- "$(realpath -- "$0")")" && pwd)"
root="$(dirname -- "$portal")"
home="$(dirname -- "$root")"
dev="$root/private-devtunnel"
runtime="$root/8f1cf40db232d0fc5afafe386245617a117f77ee/.runtime/node"
test -x "$runtime"
read -r tunnel < "$portal/tunnel-id"
[[ "$tunnel" =~ ^lean-center-ops\.[a-z0-9-]+$ ]]
exec 9>"$portal/portal.lock"
flock -n 9 || exit 0
exec > "$portal/boot.log" 2>&1
tunnel_pid=''
web_pid=''
cleanup(){
  if [[ -n "$web_pid" ]]; then kill -TERM "$web_pid" 2>/dev/null || true; wait "$web_pid" || true; fi
  if [[ -n "$tunnel_pid" ]]; then kill -TERM "$tunnel_pid" 2>/dev/null || true; wait "$tunnel_pid" || true; fi
}
trap cleanup EXIT
trap 'exit 0' TERM INT
guest_check(){
  local result code redirect
  result="$(curl -sS --max-time 8 -H 'Accept: text/html' -o /dev/null -w '%{http_code} %{redirect_url}' "$1")" || return 1
  read -r code redirect <<< "$result"
  [[ "$code" == 401 || "$code" == 403 ]] ||
    [[ "$code" =~ ^30[2378]$ && "$redirect" =~ ^https://([a-z0-9-]+\.)*(devtunnels\.ms|visualstudio\.com|microsoftonline\.com|github\.com)/ ]]
}
start_portal(){
  local origin='' ready=0 attempt
  : > "$portal/tunnel.log"
  (
    cd "$dev"
    export HOME="$dev/home" XDG_CONFIG_HOME="$dev/home/.config" XDG_CACHE_HOME="$dev/home/.cache" XDG_DATA_HOME="$dev/home/.local/share"
    exec "$dev/devtunnel" host "$tunnel"
  ) 9>&- > "$portal/tunnel.log" 2>&1 &
  tunnel_pid="$!"
  for attempt in {1..60}; do
    kill -0 "$tunnel_pid" 2>/dev/null || return 1
    origin="$(grep -m1 -oE 'https://[a-z0-9-]+-18083\.[a-z0-9-]+\.devtunnels\.ms' "$portal/tunnel.log" || true)"
    if [[ -n "$origin" ]] && grep -qi 'ready to accept connections' "$portal/tunnel.log"; then break; fi
    sleep 1
  done
  [[ "$origin" =~ ^https://[a-z0-9-]+-18083\.[a-z0-9-]+\.devtunnels\.ms$ ]] || return 1
  if [[ -f "$portal/origin" ]]; then [[ "$(cat "$portal/origin")" == "$origin" ]] || return 1; fi
  for attempt in {1..10}; do
    if guest_check "$origin/api/overview"; then ready=1; break; fi
    sleep 2
  done
  (( ready )) || return 1
  env -i PATH=/usr/bin:/bin HOME="$home" PORTAL_ORIGIN="$origin" "$runtime" "$portal/app/server.mjs" \
    9>&- > "$portal/server.log" 2>&1 &
  web_pid="$!"
  for attempt in {1..20}; do
    kill -0 "$web_pid" 2>/dev/null || return 1
    if curl -fsS --max-time 3 -H "Host: $(printf '%s' "$origin" | cut -d/ -f3)" http://127.0.0.1:18083/ >/dev/null; then
      guest_check "$origin/api/overview" || return 1
      printf '%s\n' "$origin" > "$portal/origin"
      printf 'PORTAL_READY\n' > "$portal/status"
      return 0
    fi
    sleep 1
  done
  return 1
}
for delay in 1 5 12 25; do
  printf 'STARTING\n' > "$portal/status"
  sleep "$delay"
  if start_portal; then
    wait -n "$web_pid" "$tunnel_pid" || true
  fi
  cleanup
  tunnel_pid=''
  web_pid=''
done
printf 'FAILED\n' > "$portal/status"
exit 1
